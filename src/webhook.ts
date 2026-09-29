import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import https from "node:https";
import ipaddr from "ipaddr.js";
import { Webhook } from "standardwebhooks";
import type { Subscription } from "./event-state.js";

export const MAX_PAYLOAD = 262_144;
export type WebhookResponse = { status: number; body: string };
export type WebhookSend = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<WebhookResponse>;
export function callbackUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw new Error("unsafe_callback");
  return url;
}
export function publicAddress(address: string): boolean {
  try {
    return ipaddr.parse(address).range() === "unicast";
  } catch {
    return false;
  }
}

// Resolve on EVERY connection, reject mixed public/private answers, and pin the
// socket lookup to the validated answer. TLS still verifies the original name.
export function createSafeWebhookSend(
  resolve = lookup,
  dial = https.request,
): WebhookSend {
  return async (raw, body, headers) => {
    const url = callbackUrl(raw);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const signal = AbortSignal.timeout(10_000);
    const addresses = await new Promise<LookupAddress[]>((accept, reject) => {
      const aborted = () => reject(new Error("timeout"));
      signal.addEventListener("abort", aborted, { once: true });
      resolve(hostname, { all: true })
        .then(accept, reject)
        .finally(() => signal.removeEventListener("abort", aborted));
    });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error("unsafe_address");
    const chosen = addresses[0]!;
    return new Promise((resolve, reject) => {
      const request = dial(
        url,
        {
          method: "POST",
          headers,
          agent: false,
          signal,
          lookup: ((
            _host: unknown,
            options: { all?: boolean },
            cb: (...args: unknown[]) => void,
          ) => {
            if (options.all) cb(null, [chosen]);
            else cb(null, chosen.address, chosen.family);
          }) as NonNullable<https.RequestOptions["lookup"]>,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.resume();
            reject(new Error("redirect_blocked"));
            return;
          }
          let result = "";
          response.on("data", (chunk: Buffer) => {
            result += chunk.toString("utf8");
            if (Buffer.byteLength(result) > 16_384)
              request.destroy(new Error("response_too_large"));
          });
          response.on("end", () => resolve({ status, body: result }));
          response.on("error", reject);
        },
      );
      request.on("error", reject);
      request.end(body);
    });
  };
}
export const safeWebhookSend = createSafeWebhookSend();

export async function signedPost(
  sub: Subscription,
  id: string,
  value: unknown,
  send: WebhookSend,
  now = Date.now(),
): Promise<WebhookResponse> {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > MAX_PAYLOAD)
    throw new Error("payload_too_large");
  const time = new Date(now);
  const signatures = [new Webhook(sub.secret).sign(id, time, body)];
  if (sub.previousSecret && (sub.rotateUntil ?? 0) > now)
    signatures.push(new Webhook(sub.previousSecret).sign(id, time, body));
  return send(sub.url, body, {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(now / 1000)),
    "webhook-signature": signatures.join(" "),
    "X-MCP-Subscription-Id": sub.id,
  });
}

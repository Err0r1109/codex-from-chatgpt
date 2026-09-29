import { chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";

// chmod has no ACL semantics on Windows. Use an explicit protected DACL there.
export function makePrivate(file: string, directory = false): void {
  if (process.platform !== "win32") {
    chmodSync(file, directory ? 0o700 : 0o600);
    return;
  }
  const principal = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  execFileSync(
    "icacls.exe",
    [
      file,
      "/inheritance:r",
      "/grant:r",
      `${principal}:${directory ? "(OI)(CI)" : ""}F`,
      "*S-1-5-18:F",
    ],
    { windowsHide: true, stdio: "pipe" },
  );
}

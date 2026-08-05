import { dirname } from "node:path";

export function getPackageManagerCommand(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export function getInstallArgs(hasLockfile, storeDir) {
  const args = hasLockfile ? ["install", "--frozen-lockfile"] : ["install"];

  if (storeDir) {
    args.push("--store-dir", storeDir);
  }

  return args;
}

export function getRepositoryRoot(scriptsDirectory) {
  return dirname(scriptsDirectory);
}

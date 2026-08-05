import { describe, expect, it } from "vitest";
import {
  getInstallArgs,
  getPackageManagerCommand,
  getRepositoryRoot,
} from "./harness-init-lib.mjs";

describe("harness bootstrap helpers", () => {
  it("uses the Windows pnpm executable on Windows", () => {
    expect(getPackageManagerCommand("win32")).toBe("pnpm.cmd");
  });

  it("uses the native pnpm executable on POSIX platforms", () => {
    expect(getPackageManagerCommand("linux")).toBe("pnpm");
    expect(getPackageManagerCommand("darwin")).toBe("pnpm");
  });

  it("freezes installs when a lockfile exists", () => {
    expect(getInstallArgs(true)).toEqual(["install", "--frozen-lockfile"]);
  });

  it("allows a first install when no lockfile exists", () => {
    expect(getInstallArgs(false)).toEqual(["install"]);
  });

  it("resolves the repository root from the scripts directory", () => {
    expect(getRepositoryRoot("/repo/scripts")).toBe("/repo");
  });
});

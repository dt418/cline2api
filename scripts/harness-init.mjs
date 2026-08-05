import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  getInstallArgs,
  getPackageManagerCommand,
  getRepositoryRoot,
} from "./harness/harness-init-lib.mjs";
import { validateFeatureList } from "./harness/validate-harness.mjs";

const repositoryRoot = getRepositoryRoot(dirname(fileURLToPath(import.meta.url)));
const featureListPath = join(repositoryRoot, ".harness", "feature_list.json");
const packageManager = getPackageManagerCommand();

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(`Failed to start ${command}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

function readFeatureList() {
  try {
    return JSON.parse(readFileSync(featureListPath, "utf8"));
  } catch (error) {
    console.error(`Unable to read ${featureListPath}: ${error.message}`);
    process.exitCode = 1;
    return null;
  }
}

const featureList = readFeatureList();
if (!featureList) {
  process.exit(1);
}

const validation = validateFeatureList(featureList);
if (!validation.valid) {
  console.error("Harness feature state is invalid:");
  for (const error of validation.errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

if (process.env.HARNESS_SKIP_INSTALL !== "1") {
  const installStatus = run(
    packageManager,
    getInstallArgs(
      existsSync(join(repositoryRoot, "pnpm-lock.yaml")),
      process.env.CLINE2API_PNPM_STORE_DIR,
    ),
  );
  if (installStatus !== 0) {
    process.exit(installStatus);
  }
}

const verifyStatus = run(packageManager, ["verify"]);
if (verifyStatus !== 0) {
  process.exit(verifyStatus);
}

console.log("Harness initialized successfully.");
console.log("Next commands: pnpm dev | pnpm test | pnpm verify");

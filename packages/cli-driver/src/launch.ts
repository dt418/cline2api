import { isAbsolute } from "node:path";
import { ClineCliError } from "./errors.js";
import type { ClineCliRequest, ClineTransport, LaunchSpec } from "./types.js";

const positiveNumberFields = [
  "timeoutMs",
  "cancellationGraceMs",
  "maxLineBytes",
  "maxEvents",
] as const;

const absolutePathFields = ["cwd", "configDir", "dataDir"] as const;

export function validateClineRequest(request: ClineCliRequest): void {
  if (request.prompt.trim().length === 0) {
    throw new ClineCliError("invalid_request", "validate", "prompt must not be empty");
  }

  for (const field of absolutePathFields) {
    const value = request[field];
    if (value !== undefined && !isAbsolute(value)) {
      throw new ClineCliError("invalid_request", "validate", `${field} must be absolute`);
    }
  }

  for (const field of positiveNumberFields) {
    const value = request[field];
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new ClineCliError(
        "invalid_request",
        "validate",
        `${field} must be a finite positive number`,
      );
    }
  }

  if (
    request.transport !== undefined &&
    request.transport !== "auto" &&
    request.transport !== "acp" &&
    request.transport !== "ndjson"
  ) {
    throw new ClineCliError("invalid_request", "validate", "transport is invalid");
  }
}

export function buildLaunchSpec(
  transport: ClineTransport,
  request: ClineCliRequest,
  executable: string,
  baseEnv: NodeJS.ProcessEnv,
): LaunchSpec {
  validateClineRequest(request);

  const env = { ...baseEnv };
  const args = transport === "acp" ? buildAcpArgs(request, env) : buildNdjsonArgs(request);

  return {
    command: executable,
    args,
    options: {
      cwd: request.cwd,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    },
  };
}

function buildAcpArgs(request: ClineCliRequest, env: NodeJS.ProcessEnv): string[] {
  const args = ["--acp"];
  addGlobalDirectoryFlags(args, request);

  if (request.provider !== undefined) {
    env.CLINE_PROVIDER = request.provider;
  }
  if (request.model !== undefined) {
    env.CLINE_MODEL = request.model;
  }

  return args;
}

function buildNdjsonArgs(request: ClineCliRequest): string[] {
  const args = ["--json", "--auto-approve", String(request.autoApprove ?? false)];
  addGlobalDirectoryFlags(args, request);

  if (request.provider !== undefined) {
    args.push("--provider", request.provider);
  }
  if (request.model !== undefined) {
    args.push("--model", request.model);
  }

  args.push(request.prompt);
  return args;
}

function addGlobalDirectoryFlags(args: string[], request: ClineCliRequest): void {
  if (request.configDir !== undefined) {
    args.push("--config-dir", request.configDir);
  }
  if (request.dataDir !== undefined) {
    args.push("--data-dir", request.dataDir);
  }
}

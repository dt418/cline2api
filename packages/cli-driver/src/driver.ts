import { spawn } from "node:child_process";
import { createSdkAcpConnection, startAcpTransport } from "./acp-transport.js";
import { AcpUnavailableError } from "./errors.js";
import { buildLaunchSpec, validateClineRequest } from "./launch.js";
import { startNdjsonTransport } from "./ndjson-transport.js";
import type {
  AcpTransportOptions,
  ClineCliDriver,
  ClineCliDriverOptions,
  ClineCliRequest,
  ClineCliRun,
  ClineTransport,
  NdjsonTransportOptions,
  SpawnProcess,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_CANCELLATION_GRACE_MS = 5_000;
const DEFAULT_MAX_LINE_BYTES = 1_048_576;
const DEFAULT_MAX_EVENTS = 1_000;

function spawnCline(...args: Parameters<SpawnProcess>): ReturnType<SpawnProcess> {
  return spawn(...args);
}

export function createClineCliDriver(options: ClineCliDriverOptions = {}): ClineCliDriver {
  const executable = options.executable ?? "cline";
  const spawnProcess = options.spawnProcess ?? spawnCline;
  const createAcpConnection = options.createAcpConnection ?? createSdkAcpConnection;
  const acpStarter = options.startAcpTransport ?? startAcpTransport;
  const ndjsonStarter = options.startNdjsonTransport ?? startNdjsonTransport;
  const defaults = {
    timeoutMs: options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    cancellationGraceMs: options.defaultCancellationGraceMs ?? DEFAULT_CANCELLATION_GRACE_MS,
    maxLineBytes: options.defaultMaxLineBytes ?? DEFAULT_MAX_LINE_BYTES,
    maxEvents: options.defaultMaxEvents ?? DEFAULT_MAX_EVENTS,
  };

  const startTransport = async (
    transport: ClineTransport,
    request: ClineCliRequest,
  ): Promise<ClineCliRun> => {
    const launch = buildLaunchSpec(transport, request, executable, process.env);
    const transportOptions = {
      request,
      launch,
      spawnProcess,
      timeoutMs: request.timeoutMs ?? defaults.timeoutMs,
      cancellationGraceMs: request.cancellationGraceMs ?? defaults.cancellationGraceMs,
      maxLineBytes: request.maxLineBytes ?? defaults.maxLineBytes,
      maxEvents: request.maxEvents ?? defaults.maxEvents,
    };

    if (transport === "acp") {
      return acpStarter({
        ...transportOptions,
        createConnection: createAcpConnection,
      } satisfies AcpTransportOptions);
    }
    return ndjsonStarter(transportOptions satisfies NdjsonTransportOptions);
  };

  return {
    async start(request: ClineCliRequest): Promise<ClineCliRun> {
      validateClineRequest(request);
      const transport = request.transport ?? "auto";
      if (transport === "acp" || transport === "ndjson") {
        return startTransport(transport, request);
      }

      try {
        return await startTransport("acp", request);
      } catch (error) {
        if (!(error instanceof AcpUnavailableError)) throw error;
        return startTransport("ndjson", request);
      }
    },
  };
}

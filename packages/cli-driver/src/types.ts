import type * as acp from "@agentclientprotocol/sdk";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { ClineCliErrorCode } from "./errors.js";

export type ClineTransportPreference = "auto" | "acp" | "ndjson";
export type ClineTransport = Exclude<ClineTransportPreference, "auto">;
export type ClineRunStatus = "succeeded" | "failed" | "cancelled" | "timed_out";
export type ClineEventKind = "message" | "ask" | "tool_call" | "plan";

export interface ClineCliRequest {
  readonly prompt: string;
  readonly cwd: string;
  readonly transport?: ClineTransportPreference;
  readonly provider?: string;
  readonly model?: string;
  readonly configDir?: string;
  readonly dataDir?: string;
  readonly timeoutMs?: number;
  readonly cancellationGraceMs?: number;
  readonly maxLineBytes?: number;
  readonly maxEvents?: number;
  readonly autoApprove?: boolean;
  readonly host?: ClineCliHost;
}

export interface ClineCliEvent {
  readonly transport: ClineTransport;
  readonly kind: ClineEventKind;
  readonly text?: string;
  readonly partial?: boolean;
  readonly subtype?: string;
  readonly sessionUpdate?: string;
}

export interface ClineCliDiagnostics {
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly eventCount: number;
  readonly malformedMessageCount: number;
  readonly truncated: boolean;
  readonly lastSafePhase: string;
}

export interface ClineCliResult {
  readonly transport: ClineTransport;
  readonly status: ClineRunStatus;
  readonly stopReason?: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly diagnostics: ClineCliDiagnostics;
  readonly errorCode?: ClineCliErrorCode;
}

export interface ClineCliRun {
  readonly transport: ClineTransport;
  readonly events: AsyncIterable<ClineCliEvent>;
  readonly result: Promise<ClineCliResult>;
  cancel(reason?: string): Promise<void>;
}

export interface ClineCliHost {
  readonly requestPermission?: acp.Client["requestPermission"];
  readonly readTextFile?: acp.Client["readTextFile"];
  readonly writeTextFile?: acp.Client["writeTextFile"];
  readonly createTerminal?: acp.Client["createTerminal"];
  readonly terminalOutput?: acp.Client["terminalOutput"];
  readonly releaseTerminal?: acp.Client["releaseTerminal"];
  readonly waitForTerminalExit?: acp.Client["waitForTerminalExit"];
  readonly killTerminal?: acp.Client["killTerminal"];
}

export interface LaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly shell: false;
    readonly stdio: ["pipe", "pipe", "pipe"];
  };
}

export interface ClineCliDriverOptions {
  readonly executable?: string;
  readonly spawnProcess?: SpawnProcess;
  readonly createAcpConnection?: AcpConnectionFactory;
  readonly startAcpTransport?: AcpTransportStarter;
  readonly startNdjsonTransport?: NdjsonTransportStarter;
  readonly defaultTimeoutMs?: number;
  readonly defaultCancellationGraceMs?: number;
  readonly defaultMaxLineBytes?: number;
  readonly defaultMaxEvents?: number;
}

export interface ClineCliDriver {
  start(request: ClineCliRequest): Promise<ClineCliRun>;
}

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: LaunchSpec["options"],
) => ChildProcessWithoutNullStreams;

export interface AcpConnectionFactory {
  (options: AcpConnectionOptions): Promise<AcpSessionPort>;
}

export interface AcpConnectionOptions {
  readonly child: ChildProcessWithoutNullStreams;
  readonly cwd: string;
  readonly host?: ClineCliHost;
  readonly signal: AbortSignal;
  readonly emit: (event: ClineCliEvent) => void;
  readonly markSessionStarted: () => void;
}

export interface AcpSessionPort {
  readonly sessionId: string;
  prompt(prompt: string): Promise<string>;
  nextUpdate(): Promise<AcpSessionMessage>;
  cancel(): Promise<void>;
  dispose(): void;
}

export type AcpSessionMessage =
  | { readonly kind: "update"; readonly event: ClineCliEvent }
  | { readonly kind: "stop"; readonly stopReason: string };

export interface TransportOptions {
  readonly request: ClineCliRequest;
  readonly launch: LaunchSpec;
  readonly spawnProcess: SpawnProcess;
  readonly timeoutMs: number;
  readonly cancellationGraceMs: number;
  readonly maxLineBytes: number;
  readonly maxEvents: number;
}

export type NdjsonLimits = Pick<TransportOptions, "maxLineBytes" | "maxEvents">;
export type NdjsonTransportOptions = TransportOptions;

export interface AcpTransportOptions extends TransportOptions {
  readonly createConnection: AcpConnectionFactory;
}

export type NdjsonTransportStarter = (options: NdjsonTransportOptions) => ClineCliRun;
export type AcpTransportStarter = (options: AcpTransportOptions) => Promise<ClineCliRun>;

export interface PendingPermissionRegistry {
  register(cancel: () => void): () => void;
  cancelAll(): void;
}

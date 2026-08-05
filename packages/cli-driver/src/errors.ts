export type ClineCliErrorCode =
  | "invalid_request"
  | "spawn_failed"
  | "acp_unavailable"
  | "authentication_required"
  | "permission_unavailable"
  | "protocol_error"
  | "timeout"
  | "cancelled"
  | "process_exit";

export class ClineCliError extends Error {
  readonly code: ClineCliErrorCode;
  readonly phase: string;

  constructor(code: ClineCliErrorCode, phase: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ClineCliError";
    this.code = code;
    this.phase = phase;
  }
}

export class AcpUnavailableError extends ClineCliError {
  constructor(phase: "spawn" | "initialize", cause?: unknown) {
    super("acp_unavailable", phase, "ACP is unavailable", cause);
    this.name = "AcpUnavailableError";
  }
}

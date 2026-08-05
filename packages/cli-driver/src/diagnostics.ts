import type { ClineCliDiagnostics } from "./types.js";

export interface DiagnosticLimits {
  readonly maxEvents: number;
}

export class BoundedDiagnostics {
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private eventCount = 0;
  private malformedMessageCount = 0;
  private truncated = false;
  private lastSafePhase = "created";

  constructor(private readonly limits: DiagnosticLimits) {}

  setPhase(phase: string): void {
    this.lastSafePhase = phase;
  }

  recordStdout(bytes: number): void {
    this.stdoutBytes += bytes;
  }

  recordStderr(bytes: number): void {
    this.stderrBytes += bytes;
  }

  recordEvent(): boolean {
    if (this.eventCount >= this.limits.maxEvents) {
      this.truncated = true;
      return false;
    }

    this.eventCount += 1;
    return true;
  }

  recordMalformedMessage(): void {
    this.malformedMessageCount += 1;
  }

  markTruncated(): void {
    this.truncated = true;
  }

  snapshot(): ClineCliDiagnostics {
    return {
      stdoutBytes: this.stdoutBytes,
      stderrBytes: this.stderrBytes,
      eventCount: this.eventCount,
      malformedMessageCount: this.malformedMessageCount,
      truncated: this.truncated,
      lastSafePhase: this.lastSafePhase,
    };
  }
}

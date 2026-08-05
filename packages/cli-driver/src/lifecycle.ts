export type RunPhase =
  | "created"
  | "starting"
  | "initializing"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

const terminalPhases: ReadonlySet<RunPhase> = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

export function transitionPhase(current: RunPhase, next: RunPhase): RunPhase {
  return terminalPhases.has(current) ? current : next;
}

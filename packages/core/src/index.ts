export interface RuntimeIdentity {
  readonly name: "cline2api";
  readonly version: string;
}

export function createRuntimeIdentity(version: string): RuntimeIdentity {
  if (!version.trim()) {
    throw new Error("version must not be empty");
  }

  return { name: "cline2api", version };
}

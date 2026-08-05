import type { ServerResponse } from "node:http";
import type { RuntimeIdentity } from "@cline2api/core";
import type { ModelCatalogSnapshot } from "../catalog/types.js";
import type { ApiErrorBody, HealthResponse, OpenAiModel, OpenAiModelsResponse } from "./types.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
} as const;

export function createHealthResponse(identity: RuntimeIdentity): HealthResponse {
  return {
    status: "ok",
    service: identity.name,
    version: identity.version,
    ready: true,
  };
}

export function createModelsResponse(snapshot: ModelCatalogSnapshot): OpenAiModelsResponse {
  return {
    object: "list",
    data: snapshot.entries.map(createOpenAiModel),
  };
}

export function createApiErrorBody(code: "not_found" | "method_not_allowed"): ApiErrorBody {
  return {
    error:
      code === "not_found"
        ? {
            message: "route not found",
            type: "invalid_request_error",
            code,
          }
        : {
            message: "method not allowed",
            type: "invalid_request_error",
            code,
          },
  };
}

export function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const headers: Record<string, string> = { ...JSON_HEADERS };

  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    if (name.toLowerCase() === "allow") {
      headers.Allow = value;
    }
  }

  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

function createOpenAiModel(entry: ModelCatalogSnapshot["entries"][number]): OpenAiModel {
  return {
    id: entry.id,
    object: "model",
    created: entry.created ?? 0,
    owned_by: entry.ownedBy ?? "cline2api",
  };
}

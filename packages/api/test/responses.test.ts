import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createRuntimeIdentity } from "@cline2api/core";
import {
  createApiErrorBody,
  createHealthResponse,
  createModelsResponse,
  writeJson,
} from "../src/http/responses.js";
import type { ModelCatalogSnapshot } from "../src/catalog/types.js";

class FakeServerResponse {
  status: number | undefined;
  headers: Record<string, string> | undefined;
  body: string | undefined;

  writeHead(status: number, headers: Record<string, string>): void {
    this.status = status;
    this.headers = headers;
  }

  end(body: string): void {
    this.body = body;
  }
}

describe("HTTP response projections", () => {
  it("creates the stable health response from the runtime identity", () => {
    expect(createHealthResponse(createRuntimeIdentity("0.1.0"))).toEqual({
      status: "ok",
      service: "cline2api",
      version: "0.1.0",
      ready: true,
    });
  });

  it("projects only OpenAI-compatible model fields in snapshot order", () => {
    const snapshot = {
      entries: [
        {
          id: "provider/first",
          created: 7,
          ownedBy: "vendor",
          providerUrl: "https://provider.example.test",
          authorization: "Bearer secret-value",
        },
        { id: "provider/second", ownedBy: "second-vendor" },
      ],
    } as unknown as ModelCatalogSnapshot;

    expect(createModelsResponse(snapshot)).toEqual({
      object: "list",
      data: [
        { id: "provider/first", object: "model", created: 7, owned_by: "vendor" },
        {
          id: "provider/second",
          object: "model",
          created: 0,
          owned_by: "second-vendor",
        },
      ],
    });
  });

  it("uses safe model defaults and the fixed not-found error", () => {
    expect(createModelsResponse({ entries: [{ id: "model" }] })).toEqual({
      object: "list",
      data: [{ id: "model", object: "model", created: 0, owned_by: "cline2api" }],
    });
    expect(createApiErrorBody("not_found")).toEqual({
      error: { message: "route not found", type: "invalid_request_error", code: "not_found" },
    });
  });

  it("creates the fixed method-not-allowed error", () => {
    expect(createApiErrorBody("method_not_allowed")).toEqual({
      error: {
        message: "method not allowed",
        type: "invalid_request_error",
        code: "method_not_allowed",
      },
    });
  });

  it("writes a JSON response with fixed headers, an Allow header, and no source metadata", () => {
    const response = new FakeServerResponse();
    const snapshot = {
      entries: [
        {
          id: "provider/model",
          created: 7,
          ownedBy: "vendor",
          rawPayload: { token: "secret-value" },
        },
      ],
    } as unknown as ModelCatalogSnapshot;

    writeJson(response as unknown as ServerResponse, 405, createModelsResponse(snapshot), {
      Allow: "GET",
    });

    expect(response.status).toBe(405);
    expect(response.headers).toEqual({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Allow: "GET",
    });
    expect(response.body).toBe(
      JSON.stringify({
        object: "list",
        data: [{ id: "provider/model", object: "model", created: 7, owned_by: "vendor" }],
      }),
    );
    expect(response.body).not.toContain("secret-value");
  });

  it("writes required JSON headers without optional headers", () => {
    const response = new FakeServerResponse();

    writeJson(response as unknown as ServerResponse, 200, { status: "ok" });

    expect(response.headers).toEqual({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
  });

  it("keeps required JSON headers when optional headers use reserved names", () => {
    const response = new FakeServerResponse();

    writeJson(
      response as unknown as ServerResponse,
      200,
      { status: "ok" },
      {
        "content-type": "text/plain",
        "cache-control": "public",
        Allow: "GET",
      },
    );

    expect(response.headers).toEqual({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Allow: "GET",
    });
  });

  it("whitelists Allow and drops unsafe optional headers", () => {
    const response = new FakeServerResponse();

    writeJson(
      response as unknown as ServerResponse,
      405,
      { status: "error" },
      {
        "set-cookie": "session=secret-value",
        "transfer-encoding": "chunked",
        aLlOw: "GET",
      },
    );

    expect(response.headers).toEqual({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Allow: "GET",
    });
  });
});

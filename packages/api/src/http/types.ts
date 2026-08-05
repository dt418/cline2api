export interface HealthResponse {
  readonly status: "ok";
  readonly service: "cline2api";
  readonly version: string;
  readonly ready: true;
}

export interface OpenAiModel {
  readonly id: string;
  readonly object: "model";
  readonly created: number;
  readonly owned_by: string;
}

export interface OpenAiModelsResponse {
  readonly object: "list";
  readonly data: readonly OpenAiModel[];
}

export interface ApiErrorBody {
  readonly error: {
    readonly message: "route not found" | "method not allowed";
    readonly type: "invalid_request_error";
    readonly code: "not_found" | "method_not_allowed";
  };
}

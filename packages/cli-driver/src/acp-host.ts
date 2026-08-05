import * as acp from "@agentclientprotocol/sdk";
import type { ClineCliEvent, ClineCliHost, PendingPermissionRegistry } from "./types.js";

export function buildClientCapabilities(host?: ClineCliHost): acp.ClientCapabilities {
  const fs: acp.FileSystemCapabilities = {};
  if (host?.readTextFile !== undefined) fs.readTextFile = true;
  if (host?.writeTextFile !== undefined) fs.writeTextFile = true;

  const terminal =
    host?.createTerminal !== undefined &&
    host.terminalOutput !== undefined &&
    host.releaseTerminal !== undefined &&
    host.waitForTerminalExit !== undefined &&
    host.killTerminal !== undefined;

  return {
    ...(Object.keys(fs).length > 0 ? { fs } : {}),
    ...(terminal ? { terminal: true } : {}),
  };
}

function defaultPermissionResponse(
  params: acp.RequestPermissionRequest,
): acp.RequestPermissionResponse {
  const rejectOnce = params.options.find((option) => option.kind === "reject_once");
  return rejectOnce === undefined
    ? { outcome: { outcome: "cancelled" } }
    : { outcome: { outcome: "selected", optionId: rejectOnce.optionId } };
}

function normalizeSessionUpdate(params: acp.SessionNotification): ClineCliEvent | undefined {
  const update = params.update;
  if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
    return {
      transport: "acp",
      kind: "message",
      text: update.content.text,
      partial: true,
      sessionUpdate: update.sessionUpdate,
    };
  }
  if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
    return { transport: "acp", kind: "tool_call", sessionUpdate: update.sessionUpdate };
  }
  if (
    update.sessionUpdate === "plan" ||
    update.sessionUpdate === "plan_update" ||
    update.sessionUpdate === "plan_removed"
  ) {
    return { transport: "acp", kind: "plan", sessionUpdate: update.sessionUpdate };
  }
  return undefined;
}

export function createAcpClient(
  host: ClineCliHost | undefined,
  emit: (event: ClineCliEvent) => void,
  pending: PendingPermissionRegistry,
): acp.ClientApp {
  const app = acp
    .client({ name: "cline2api" })
    .onNotification(acp.methods.client.session.update, (context) => {
      const event = normalizeSessionUpdate(context.params);
      if (event !== undefined) emit(event);
    })
    .onRequest(
      acp.methods.client.session.requestPermission,
      (context) =>
        new Promise((resolve, reject) => {
          let complete = false;
          const unregister = pending.register(() => {
            if (!complete) {
              complete = true;
              unregister();
              resolve({ outcome: { outcome: "cancelled" } });
            }
          });
          const finish = (response: acp.RequestPermissionResponse): void => {
            if (!complete) {
              complete = true;
              unregister();
              resolve(response);
            }
          };
          const fail = (error: unknown): void => {
            if (!complete) {
              complete = true;
              unregister();
              reject(error);
            }
          };
          if (host?.requestPermission === undefined) {
            finish(defaultPermissionResponse(context.params));
          } else {
            Promise.resolve(host.requestPermission(context.params)).then(finish, fail);
          }
        }),
    );

  if (host?.readTextFile !== undefined) {
    app.onRequest(acp.methods.client.fs.readTextFile, (context) =>
      host.readTextFile!(context.params),
    );
  }
  if (host?.writeTextFile !== undefined) {
    app.onRequest(acp.methods.client.fs.writeTextFile, (context) =>
      host.writeTextFile!(context.params),
    );
  }
  if (
    host?.createTerminal !== undefined &&
    host.terminalOutput !== undefined &&
    host.releaseTerminal !== undefined &&
    host.waitForTerminalExit !== undefined &&
    host.killTerminal !== undefined
  ) {
    app.onRequest(acp.methods.client.terminal.create, (context) =>
      host.createTerminal!(context.params),
    );
    app.onRequest(acp.methods.client.terminal.output, (context) =>
      host.terminalOutput!(context.params),
    );
    app.onRequest(acp.methods.client.terminal.release, (context) =>
      host.releaseTerminal!(context.params),
    );
    app.onRequest(acp.methods.client.terminal.waitForExit, (context) =>
      host.waitForTerminalExit!(context.params),
    );
    app.onRequest(acp.methods.client.terminal.kill, (context) =>
      host.killTerminal!(context.params),
    );
  }
  return app;
}

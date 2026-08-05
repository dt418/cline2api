import * as acp from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { buildClientCapabilities, createAcpClient } from "../src/acp-host.js";
import type { PendingPermissionRegistry } from "../src/types.js";

class PendingPermissions implements PendingPermissionRegistry {
  private readonly cancellations = new Set<() => void>();

  register(cancel: () => void): () => void {
    this.cancellations.add(cancel);
    return () => this.cancellations.delete(cancel);
  }

  cancelAll(): void {
    for (const cancel of this.cancellations) cancel();
  }
}

const permissionRequest = {
  sessionId: "session-1",
  toolCall: { toolCallId: "tool-1" },
  options: [
    { optionId: "allow", name: "Allow", kind: "allow_once" as const },
    { optionId: "reject", name: "Reject", kind: "reject_once" as const },
  ],
};

describe("ACP host capabilities", () => {
  it("does not advertise filesystem or terminal access without callbacks", () => {
    expect(buildClientCapabilities()).toEqual({});
  });

  it("advertises only the supplied filesystem callback", () => {
    expect(buildClientCapabilities({ readTextFile: async () => ({ content: "text" }) })).toEqual({
      fs: { readTextFile: true },
    });
  });

  it("advertises terminal access only for a complete terminal callback set", () => {
    const incomplete = buildClientCapabilities({
      createTerminal: async () => ({ terminalId: "t" }),
    });
    const complete = buildClientCapabilities({
      createTerminal: async () => ({ terminalId: "t" }),
      terminalOutput: async () => ({ output: "", truncated: false }),
      releaseTerminal: async () => ({}),
      waitForTerminalExit: async () => ({ exitCode: 0 }),
      killTerminal: async () => ({}),
    });

    expect(incomplete.terminal).toBeUndefined();
    expect(complete.terminal).toBe(true);
  });
});

describe("ACP host requests", () => {
  it("rejects once by default and returns cancelled when the pending registry is cancelled", async () => {
    const pending = new PendingPermissions();
    const client = createAcpClient(undefined, () => undefined, pending);
    const agentConnection = acp.agent().connect(client);

    await expect(
      agentConnection.client.request(
        acp.methods.client.session.requestPermission,
        permissionRequest,
      ),
    ).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject" },
    });

    const waiting = createAcpClient(
      {
        requestPermission: () => new Promise(() => undefined),
      },
      () => undefined,
      pending,
    );
    const waitingConnection = acp.agent().connect(waiting);
    const permission = waitingConnection.client.request(
      acp.methods.client.session.requestPermission,
      permissionRequest,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    pending.cancelAll();
    await expect(permission).resolves.toEqual({ outcome: { outcome: "cancelled" } });
    agentConnection.close();
    waitingConnection.close();
  });

  it("passes typed injected callbacks their exact request and returns their response unchanged", async () => {
    const pending = new PendingPermissions();
    const request = { sessionId: "session-1", path: "/workspace/file.txt" };
    const response = { content: "exact response" };
    let received: unknown;
    const client = createAcpClient(
      {
        readTextFile: async (params) => {
          received = params;
          return response;
        },
      },
      () => undefined,
      pending,
    );
    const connection = acp.agent().connect(client);

    await expect(
      connection.client.request(acp.methods.client.fs.readTextFile, request),
    ).resolves.toBe(response);
    expect(received).toStrictEqual(request);
    connection.close();
  });
});

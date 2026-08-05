# CLI-001 ACP-first Cline CLI Driver Design

**Status:** Approved direction — implementation has not started  
**Date:** 2026-08-05  
**Scope:** The official Cline CLI process lifecycle driver only.

## 1. Purpose

CLI-001 gives cline2api one protocol-neutral process lifecycle boundary for an
authorized, installed official Cline CLI. The driver starts a task, observes
progress, supports cancellation and timeout, and returns a bounded terminal
result without exposing raw provider output in diagnostics.

The driver is a provider adapter boundary. It is not an AI router, HTTP API,
plugin SDK, or implementation of any undocumented Cline or ClinePass protocol.

## 2. Confirmed external contracts

- Cline CLI starts ACP with 'cline --acp' and communicates with a client over
  stdio. Cline documents ACP as the interface for editors and other clients.
- ACP v1 uses JSON-RPC over stdio for local agent subprocesses. A normal turn
  negotiates initialization, creates or loads a session, sends a prompt,
  receives session updates, and can be cancelled.
- The official TypeScript ACP library is '@agentclientprotocol/sdk'; new
  integrations should use its fluent 'client()' API.
- Cline's documented NDJSON fallback is 'cline --json "<prompt>"'. Each output
  line is a JSON message with documented 'type', 'text', timestamp, subtype,
  and optional streaming fields.

References:

- [Cline ACP usage](https://github.com/cline/cline/blob/main/docs/usage/acp.mdx)
- [Cline CLI reference](https://docs.cline.bot/cli/cli-reference)
- [ACP introduction](https://agentclientprotocol.com/get-started/introduction)
- [ACP prompt lifecycle](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [ACP TypeScript library](https://agentclientprotocol.com/libraries/typescript)
- [ACP filesystem capabilities](https://agentclientprotocol.com/protocol/v1/file-system)
- [ACP permission requests](https://agentclientprotocol.com/protocol/v1/tool-calls)

The implementation targets stable ACP v1. ACP v2 is still a draft and is not a
required compatibility target for this feature.

## 3. Goals

1. Prefer ACP for every new run.
2. Fall back to documented NDJSON only when ACP is unavailable before a task
   session has started.
3. Expose one lifecycle handle regardless of the selected transport.
4. Keep host capabilities explicit: the caller injects permission, filesystem,
   and terminal callbacks; the driver provides no implicit host bridge.
5. Make cancellation, timeout, process cleanup, and bounded diagnostics
   deterministic on Windows, macOS, and Linux.
6. Keep credentials and raw provider content out of logs, snapshots, Harness
   evidence, and error diagnostics.

## 4. Non-goals

- Implementing an HTTP/OpenAI-compatible endpoint.
- Implementing a local filesystem or terminal bridge.
- Automatically approving ACP permission requests.
- Reading or emulating Cline/ClinePass internal network traffic, databases,
  session files, or private SDK behavior.
- Supporting ACP v2 before the project explicitly adds a separate compatibility
  feature.
- Replacing the provider/router behavior of downstream integrations.

## 5. Transport selection and fallback

The request accepts a transport preference:

| Preference       | Behavior                                                                         |
| ---------------- | -------------------------------------------------------------------------------- |
| 'auto' (default) | Try ACP first; fall back once to NDJSON only for pre-session ACP unavailability. |
| 'acp'            | Require ACP; return a typed ACP failure and never fall back.                     |
| 'ndjson'         | Skip ACP and use the documented '--json' command directly.                       |

An ACP failure is fallback-eligible only when the child process cannot be
started, '--acp' is rejected, the ACP stream is malformed before initialization,
or the initialization handshake times out before a session exists. An
authentication failure, permission rejection, session creation failure, prompt
failure, timeout after session creation, or cancellation is a real run result;
it must not be retried through a second transport.

This rule prevents duplicate tasks and avoids hiding a real Cline failure behind
a second invocation.

## 6. ACP primary path

### 6.1 Process launch

The driver launches the configured Cline executable directly with Node's
spawn, shell: false, and piped stdin/stdout/stderr. The default command is
'cline'; callers may provide an absolute executable path for environments where
the child process does not inherit the user's PATH.

Only documented launch configuration is forwarded. The initial request may
provide an absolute working directory, provider/model selection, isolated data
or config directories, and a timeout. API keys are not accepted as a driver
field in this feature. Existing 'cline auth' state remains the authentication
source.

### 6.2 Initialization and host capabilities

The driver connects an ACP 'client()' over the child's stdio NDJSON stream and
initializes using the negotiated ACP v1 version and a 'cline2api' client
identity.

Host callbacks are opt-in:

- 'requestPermission' is injected by the caller. If absent, the driver returns a
  documented reject-once outcome rather than auto-approving or hanging.
- 'readTextFile' and 'writeTextFile' are advertised only when the corresponding
  callbacks are supplied. No filesystem capability is advertised by default.
- Terminal capability is advertised only when the caller supplies the complete
  terminal lifecycle adapter. The driver does not execute shell commands on the
  caller's behalf.

Callback payloads are delivered to the caller as protocol data but are never
copied into diagnostics or Harness artifacts. Callback exceptions become typed
host failures and trigger normal cancellation/cleanup.

### 6.3 Session lifecycle

The primary path follows this sequence:

1. Spawn 'cline --acp'.
2. Initialize ACP and record only negotiated version/capability metadata.
3. Create a new session rooted at the request working directory.
4. Send the user prompt.
5. Convert 'session/update' notifications and the final stop reason into the
   common event/result model.
6. On cancellation, send 'session/cancel', resolve pending permission requests
   with the cancelled outcome, wait for the configured grace period, and then
   terminate the child if it remains alive.
7. On timeout, perform the same cancellation path but return 'timed_out'.
8. Close the ACP connection and child process exactly once.

The lifecycle handle exposes an async event stream, a terminal 'result' promise,
and an idempotent 'cancel()' operation. Calling 'cancel()' after completion is a
no-op.

## 7. NDJSON fallback path

The fallback launches the official documented form:

    cline --json --auto-approve <boolean> <prompt>

Arguments are passed directly, never through a shell. Output is parsed one
newline at a time. The parser accepts only documented JSON message fields,
normalizes message/streaming metadata, ignores unknown fields, and tracks
malformed or oversized lines in bounded counters.

The common request defaults 'autoApprove' to false so the driver never grants
implicit tool permission. A caller that explicitly wants unattended NDJSON
execution must opt into 'autoApprove: true'. NDJSON has no ACP permission
callback channel in this feature; an 'ask' event without an explicit approval
policy is surfaced and the run is cancelled before the timeout can hang it.

The fallback uses the same timeout, cancellation, process cleanup, event limit,
and diagnostics limits as ACP.

## 8. Common lifecycle model

The transport-specific implementations normalize to one result shape:

    transport: 'acp' | 'ndjson'
    status: 'succeeded' | 'failed' | 'cancelled' | 'timed_out'
    stopReason?: string
    exitCode: number | null
    signal: string | null
    events: AsyncIterable<normalized event>
    diagnostics: {
      stdoutBytes: number
      stderrBytes: number
      eventCount: number
      malformedMessageCount: number
      truncated: boolean
      lastSafePhase: string
    }

Diagnostics contain counters, fixed categories, and safe lifecycle metadata
only. They never contain raw stdout/stderr, prompts, provider responses, API
keys, authorization headers, cookies, or callback payloads. Event content is
streamed to the caller but is not persisted by the driver.

The state machine is monotonic:

    created → starting → initializing → running → cancelling → cancelled
                                          ├──────→ succeeded
                                          ├──────→ failed
                                          └──────→ timed_out

Only one terminal transition is allowed. A child exit after cancellation cannot
overwrite 'cancelled' or 'timed_out' with a generic failure.

## 9. Cross-platform process rules

- Use Node process and stream APIs as the canonical implementation.
- Never require 'bash', 'sh', 'zsh', PowerShell, 'taskkill', or POSIX signal
  semantics in the driver contract.
- Pass arguments as an array and set shell: false.
- Normalize CRLF/LF framing in the stream parser.
- Use Node child-process termination with a bounded grace period; do not build a
  platform-specific shell command to kill the process tree.
- Inject the process factory at the test boundary so lifecycle tests can run on
  every supported platform without installing Cline or using real credentials.

## 10. Verification strategy

The implementation must be test-first and add focused tests before production
code for:

1. ACP-first transport selection and eligible/non-eligible fallback decisions.
2. Cross-platform launch argument construction and no-shell process options.
3. ACP initialization/session/prompt/update/stop mapping using documented v1
   messages.
4. Callback capability advertisement and default permission rejection.
5. ACP cancellation, pending-permission cancellation, timeout, and idempotent
   cleanup.
6. NDJSON parsing, CRLF framing, malformed/oversized line bounds, and 'ask'
   handling.
7. Shared result mapping and bounded, secret-free diagnostics.
8. Process spawn failure, non-zero exit, signal exit, and unexpected stream
   closure.

The declared feature verification must include the focused unit/contract suite,
'pnpm verify', 'HARNESS_SKIP_INSTALL=1 pnpm harness:init', and
'git diff --check'. Any optional live Cline contract test must be opt-in through
an explicitly configured executable and authenticated environment; no secret or
raw provider output may be recorded as evidence.

## 11. Acceptance criteria

CLI-001 is passing only when:

- ACP is attempted by default and a pre-session ACP unavailability can fall back
  exactly once to NDJSON.
- Explicit 'acp' never silently falls back, and explicit 'ndjson' never starts
  ACP.
- Callers can observe progress, cancel, time out, and await one terminal result.
- No implicit filesystem, terminal, or permission approval occurs in ACP.
- The same lifecycle and diagnostics guarantees hold for the NDJSON path.
- Tests pass on the supported platform matrix or use platform-neutral injected
  process fixtures with a documented rationale.
- Harness state, progress, handoff, quality evidence, and clean-state checklist
  are updated from command output before the feature is marked 'passing'.

## 12. Follow-up boundaries

Later features may add a secure configuration/secret-redaction layer, an
OpenAI-compatible HTTP adapter, a built-in workspace/terminal host, and plugin
contracts. Those changes must consume this lifecycle boundary rather than
creating a second Cline process implementation.

# CLI-001 ACP-first Cline CLI Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a cross-platform TypeScript driver that prefers the official Cline CLI's ACP v1 process interface and falls back once to documented NDJSON only when ACP is unavailable before a session starts.

**Architecture:** Add a focused private workspace package, @cline2api/cli-driver, with a common lifecycle handle over two transport implementations. The ACP implementation uses @agentclientprotocol/sdk over child-process stdio and advertises only caller-injected host callbacks; the NDJSON implementation parses documented newline-delimited messages. A small orchestrator owns validation, transport selection, timeout/cancellation, fallback eligibility, and the shared bounded result.

**Tech Stack:** Node.js 20+, TypeScript/NodeNext, pnpm workspace, Vitest, Node child_process and stream APIs, @agentclientprotocol/sdk 1.3.0.

## Global Constraints

- Use only documented official Cline CLI behavior and stable ACP v1; do not inspect or emulate Cline/ClinePass internals.
- The default transport preference is auto: ACP first, one NDJSON fallback only before ACP creates a session.
- Host permission, filesystem, and terminal behavior is callback-injected; no implicit capability or auto-approval is allowed in ACP.
- The canonical process launch uses Node spawn with shell: false and an argument array on Windows, macOS, and Linux.
- API keys, authorization headers, cookies, raw prompts, raw provider responses, and raw stdout/stderr never enter diagnostics, snapshots, Harness evidence, or commits.
- Every production function follows TDD: failing focused test, observed failure, minimal implementation, passing test, then refactor.
- Do not add an HTTP server, router, local filesystem bridge, or terminal bridge in CLI-001.
- Run focused tests, pnpm verify, HARNESS_SKIP_INSTALL=1 pnpm harness:init, and git diff --check before marking CLI-001 passing.

---

### Task 1: Add the cli-driver package and stable public contracts

**Files:**

- Create: packages/cli-driver/package.json
- Create: packages/cli-driver/tsconfig.json
- Create: packages/cli-driver/src/types.ts
- Create: packages/cli-driver/src/errors.ts
- Create: packages/cli-driver/src/launch.ts
- Create: packages/cli-driver/test/launch.test.ts
- Modify: tsconfig.json to add the packages/cli-driver project reference
- Modify: pnpm-lock.yaml through the locked install command

**Interfaces:**

- Produces the public transport, request, host, event, diagnostics, result, lifecycle, and driver option types used by every later task.
- Produces validateClineRequest(request: ClineCliRequest): void.
- Produces buildLaunchSpec(transport: ClineTransport, request: ClineCliRequest, executable: string, baseEnv: NodeJS.ProcessEnv): LaunchSpec.
- The package depends on @agentclientprotocol/sdk at version 1.3.0 and exposes its own source entrypoint through packages/cli-driver/src/index.ts in Task 5.

- [ ] **Step 1: Write the failing contract and launch tests**

Add a test file with these assertions:

    import { describe, expect, it } from 'vitest';
    import { buildLaunchSpec, validateClineRequest } from '../src/launch.js';

    const request = {
      prompt: 'inspect the repository',
      cwd: '/workspace/project',
      transport: 'acp' as const,
    };

    describe('Cline CLI launch contract', () => {
      it('rejects an empty prompt and a relative cwd', () => {
        expect(() => validateClineRequest({ ...request, prompt: '  ' })).toThrow('prompt');
        expect(() => validateClineRequest({ ...request, cwd: 'project' })).toThrow('absolute');
      });

      it('builds an ACP launch without a prompt argument or shell', () => {
        const launch = buildLaunchSpec('acp', request, 'cline', {});
        expect(launch.command).toBe('cline');
        expect(launch.args).toEqual(['--acp']);
        expect(launch.options.cwd).toBe('/workspace/project');
        expect(launch.options.shell).toBe(false);
      });

      it('builds a documented NDJSON launch with explicit approval', () => {
        const launch = buildLaunchSpec(
          'ndjson',
          { ...request, model: 'provider/model', autoApprove: true },
          'cline',
          {},
        );
        expect(launch.args).toEqual([
          '--json',
          '--auto-approve',
          'true',
          '--model',
          'provider/model',
          'inspect the repository',
        ]);
      });
    });

- [ ] **Step 2: Run the focused tests and confirm the expected failure**

Run:

    pnpm exec vitest run packages/cli-driver/test/launch.test.ts

Expected: FAIL because the new package source files and functions do not exist.

- [ ] **Step 3: Define the public types and typed errors**

Create packages/cli-driver/src/types.ts with these exact concepts:

    export type ClineTransportPreference = 'auto' | 'acp' | 'ndjson';
    export type ClineTransport = Exclude<ClineTransportPreference, 'auto'>;
    export type ClineRunStatus = 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
    export type ClineEventKind = 'message' | 'ask' | 'tool_call' | 'plan';

    export interface ClineCliRequest {
      readonly prompt: string;
      readonly cwd: string;
      readonly transport?: ClineTransportPreference;
      readonly provider?: string;
      readonly model?: string;
      readonly configDir?: string;
      readonly dataDir?: string;
      readonly timeoutMs?: number;
      readonly cancellationGraceMs?: number;
      readonly maxLineBytes?: number;
      readonly maxEvents?: number;
      readonly autoApprove?: boolean;
      readonly host?: ClineCliHost;
    }

    export interface ClineCliEvent {
      readonly transport: ClineTransport;
      readonly kind: ClineEventKind;
      readonly text?: string;
      readonly partial?: boolean;
      readonly subtype?: string;
      readonly sessionUpdate?: string;
    }

    export interface ClineCliDiagnostics {
      readonly stdoutBytes: number;
      readonly stderrBytes: number;
      readonly eventCount: number;
      readonly malformedMessageCount: number;
      readonly truncated: boolean;
      readonly lastSafePhase: string;
    }

    export interface ClineCliResult {
      readonly transport: ClineTransport;
      readonly status: ClineRunStatus;
      readonly stopReason?: string;
      readonly exitCode: number | null;
      readonly signal: string | null;
      readonly diagnostics: ClineCliDiagnostics;
      readonly errorCode?: ClineCliErrorCode;
    }

    export interface ClineCliRun {
      readonly transport: ClineTransport;
      readonly events: AsyncIterable<ClineCliEvent>;
      readonly result: Promise<ClineCliResult>;
      cancel(reason?: string): Promise<void>;
    }

    export interface ClineCliHost {
      readonly requestPermission?: acp.Client['requestPermission'];
      readonly readTextFile?: acp.Client['readTextFile'];
      readonly writeTextFile?: acp.Client['writeTextFile'];
      readonly createTerminal?: acp.Client['createTerminal'];
      readonly terminalOutput?: acp.Client['terminalOutput'];
      readonly releaseTerminal?: acp.Client['releaseTerminal'];
      readonly waitForTerminalExit?: acp.Client['waitForTerminalExit'];
      readonly killTerminal?: acp.Client['killTerminal'];
    }

    export interface LaunchSpec {
      readonly command: string;
      readonly args: readonly string[];
      readonly options: {
        readonly cwd: string;
        readonly env: NodeJS.ProcessEnv;
        readonly shell: false;
        readonly stdio: ['pipe', 'pipe', 'pipe'];
      };
    }

    export interface ClineCliDriverOptions {
      readonly executable?: string;
      readonly spawnProcess?: SpawnProcess;
      readonly createAcpConnection?: AcpConnectionFactory;
      readonly startAcpTransport?: AcpTransportStarter;
      readonly startNdjsonTransport?: NdjsonTransportStarter;
      readonly defaultTimeoutMs?: number;
      readonly defaultCancellationGraceMs?: number;
      readonly defaultMaxLineBytes?: number;
      readonly defaultMaxEvents?: number;
    }

    export interface ClineCliDriver {
      start(request: ClineCliRequest): Promise<ClineCliRun>;
    }

    export type SpawnProcess = (
      command: string,
      args: readonly string[],
      options: LaunchSpec['options'],
    ) => ChildProcessWithoutNullStreams;

    export interface AcpConnectionFactory {
      (options: AcpConnectionOptions): Promise<AcpSessionPort>;
    }

    export interface AcpConnectionOptions {
      readonly child: ChildProcessWithoutNullStreams;
      readonly cwd: string;
      readonly host?: ClineCliHost;
      readonly emit: (event: ClineCliEvent) => void;
      readonly markSessionStarted: () => void;
    }

    export interface AcpSessionPort {
      readonly sessionId: string;
      prompt(prompt: string): Promise<string>;
      nextUpdate(): Promise<AcpSessionMessage>;
      cancel(): Promise<void>;
      dispose(): void;
    }

    export type AcpSessionMessage =
      | { readonly kind: 'update'; readonly event: ClineCliEvent }
      | { readonly kind: 'stop'; readonly stopReason: string };

    export interface TransportOptions {
      readonly request: ClineCliRequest;
      readonly launch: LaunchSpec;
      readonly spawnProcess: SpawnProcess;
      readonly timeoutMs: number;
      readonly cancellationGraceMs: number;
      readonly maxLineBytes: number;
      readonly maxEvents: number;
    }

    export type NdjsonLimits = Pick<TransportOptions, 'maxLineBytes' | 'maxEvents'>;
    export type NdjsonTransportOptions = TransportOptions;
    export interface AcpTransportOptions extends TransportOptions {
      readonly createConnection: AcpConnectionFactory;
    }

    export type NdjsonTransportStarter = (
      options: NdjsonTransportOptions,
    ) => ClineCliRun;
    export type AcpTransportStarter = (
      options: AcpTransportOptions,
    ) => Promise<ClineCliRun>;

    export interface PendingPermissionRegistry {
      register(cancel: () => void): () => void;
      cancelAll(): void;
    }

Import Node child_process types and the ACP SDK types with type-only imports. Define packages/cli-driver/src/errors.ts with ClineCliError carrying code, phase, and optional cause; use codes spawn_failed, acp_unavailable, authentication_required, permission_unavailable, protocol_error, timeout, cancelled, and process_exit.

Define these exact error signatures in packages/cli-driver/src/errors.ts:

    export type ClineCliErrorCode =
      | 'invalid_request'
      | 'spawn_failed'
      | 'acp_unavailable'
      | 'authentication_required'
      | 'permission_unavailable'
      | 'protocol_error'
      | 'timeout'
      | 'cancelled'
      | 'process_exit';

    export class ClineCliError extends Error {
      readonly code: ClineCliErrorCode;
      readonly phase: string;
      constructor(code: ClineCliErrorCode, phase: string, message: string, cause?: unknown);
    }

    export class AcpUnavailableError extends ClineCliError {
      constructor(phase: 'spawn' | 'initialize', cause?: unknown);
    }

- [ ] **Step 4: Implement request validation and launch construction**

Implement validateClineRequest to reject blank prompts, non-absolute cwd/configDir/dataDir values, non-finite or non-positive timeout/limit values, and invalid transport values. Implement buildLaunchSpec with these rules:

    ACP: args begin with ['--acp']; provider and model are copied to CLINE_PROVIDER and CLINE_MODEL in a cloned environment; configDir and dataDir use the documented global flags when present.
    NDJSON: args begin with ['--json', '--auto-approve', String(request.autoApprove ?? false)]; provider and model use the documented --provider and --model flags; the prompt is the final argument.
    Both: options use the absolute request.cwd, a cloned baseEnv, shell: false, and stdio: ['pipe', 'pipe', 'pipe']; no shell interpolation is performed.

- [ ] **Step 5: Run the focused tests and confirm they pass**

Run:

    pnpm exec vitest run packages/cli-driver/test/launch.test.ts

Expected: PASS with all launch validation and argument assertions green.

- [ ] **Step 6: Add the package manifest and project reference, then commit**

Set packages/cli-driver/package.json to private package name @cline2api/cli-driver, type module, exports to dist/index.js and dist/index.d.ts, and dependency @agentclientprotocol/sdk: 1.3.0. Add a composite cli-driver tsconfig extending the base config. Add its project reference to root tsconfig.json. Run:

    pnpm install --lockfile-only --store-dir /workspace/.pnpm-store
    pnpm typecheck
    git add packages/cli-driver tsconfig.json pnpm-lock.yaml
    git commit -m "feat: add CLI driver contracts"

Expected: the lockfile and project reference are valid, and TypeScript has no new diagnostics.

### Task 2: Add bounded diagnostics, async event delivery, and terminal state transitions

**Files:**

- Create: packages/cli-driver/src/async-queue.ts
- Create: packages/cli-driver/src/diagnostics.ts
- Create: packages/cli-driver/src/lifecycle.ts
- Create: packages/cli-driver/test/async-queue.test.ts
- Create: packages/cli-driver/test/diagnostics.test.ts
- Create: packages/cli-driver/test/lifecycle.test.ts

**Interfaces:**

- Produces AsyncQueue<T> for the common event stream.
- Produces BoundedDiagnostics with numeric counters and a safe phase snapshot.
- Produces transitionPhase(current: RunPhase, next: RunPhase): RunPhase and terminal precedence used by both transports.

- [ ] **Step 1: Write failing queue, diagnostics, and state tests**

Use tests that require:

    const queue = new AsyncQueue<string>();
    const pending = queue[Symbol.asyncIterator]().next();
    queue.push('chunk');
    await expect(pending).resolves.toEqual({ value: 'chunk', done: false });
    queue.close();
    await expect(queue[Symbol.asyncIterator]().next()).resolves.toEqual({ value: undefined, done: true });

    const diagnostics = new BoundedDiagnostics({ maxEvents: 1 });
    diagnostics.setPhase('running');
    diagnostics.recordStdout(10);
    diagnostics.recordStderr(7);
    diagnostics.recordEvent();
    diagnostics.recordEvent();
    expect(diagnostics.snapshot()).toEqual({
      stdoutBytes: 10,
      stderrBytes: 7,
      eventCount: 1,
      malformedMessageCount: 0,
      truncated: true,
      lastSafePhase: 'running',
    });

    expect(transitionPhase('running', 'succeeded')).toBe('succeeded');
    expect(transitionPhase('succeeded', 'failed')).toBe('succeeded');
    expect(transitionPhase('running', 'timed_out')).toBe('timed_out');

- [ ] **Step 2: Run the tests and confirm failure**

Run:

    pnpm exec vitest run packages/cli-driver/test/async-queue.test.ts packages/cli-driver/test/diagnostics.test.ts packages/cli-driver/test/lifecycle.test.ts

Expected: FAIL because the queue, diagnostics, and lifecycle modules do not exist.

- [ ] **Step 3: Implement the queue, counters, and monotonic state machine**

Implement:

    export class AsyncQueue<T> implements AsyncIterable<T> {
      push(value: T): void;
      close(error?: Error): void;
      [Symbol.asyncIterator](): AsyncIterator<T>;
    }

    export interface DiagnosticLimits {
      readonly maxEvents: number;
    }

    export class BoundedDiagnostics {
      constructor(limits: DiagnosticLimits);
      setPhase(phase: string): void;
      recordStdout(bytes: number): void;
      recordStderr(bytes: number): void;
      recordEvent(): boolean;
      recordMalformedMessage(): void;
      markTruncated(): void;
      snapshot(): ClineCliDiagnostics;
    }

    export type RunPhase = 'created' | 'starting' | 'initializing' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
    export function transitionPhase(current: RunPhase, next: RunPhase): RunPhase;

AsyncQueue must deliver already-buffered values before completion, resolve all pending readers on close, and reject pending readers when closed with an error. BoundedDiagnostics must cap event count, count bytes only, and never accept payload strings. transitionPhase must preserve an existing terminal phase and must allow cancellation or timeout to win over a later child exit.

- [ ] **Step 4: Run the focused tests and commit**

Run:

    pnpm exec vitest run packages/cli-driver/test/async-queue.test.ts packages/cli-driver/test/diagnostics.test.ts packages/cli-driver/test/lifecycle.test.ts

Expected: PASS. Then run:

    git add packages/cli-driver/src/async-queue.ts packages/cli-driver/src/diagnostics.ts packages/cli-driver/src/lifecycle.ts packages/cli-driver/test
    git commit -m "feat: add bounded CLI lifecycle primitives"

### Task 3: Implement the documented NDJSON transport

**Files:**

- Create: packages/cli-driver/src/ndjson-parser.ts
- Create: packages/cli-driver/src/ndjson-transport.ts
- Create: packages/cli-driver/test/ndjson-parser.test.ts
- Create: packages/cli-driver/test/ndjson-transport.test.ts

**Interfaces:**

- Consumes the launch/process types from Task 1 and AsyncQueue/BoundedDiagnostics/RunPhase from Task 2.
- Produces normalizeNdjsonMessage(value: unknown): ClineCliEvent | undefined.
- Produces consumeNdjsonOutput(stream: NodeJS.ReadableStream, queue: AsyncQueue<ClineCliEvent>, diagnostics: BoundedDiagnostics, limits: NdjsonLimits): Promise<void>.
- Produces startNdjsonTransport(options: NdjsonTransportOptions): ClineCliRun.

- [ ] **Step 1: Write failing parser tests**

Cover the documented message shape, partial streaming, CRLF framing, unknown fields, malformed JSON, non-object JSON, oversized lines, and the ask event:

    expect(normalizeNdjsonMessage({
      type: 'say',
      text: 'hello',
      say: 'text',
      ts: 1,
      partial: true,
    })).toEqual({
      transport: 'ndjson',
      kind: 'message',
      text: 'hello',
      subtype: 'text',
      partial: true,
    });

    expect(normalizeNdjsonMessage({ type: 'unknown', text: 'ignore' })).toBeUndefined();
    expect(normalizeNdjsonMessage('not an object')).toBeUndefined();

- [ ] **Step 2: Run parser tests and confirm failure**

Run:

    pnpm exec vitest run packages/cli-driver/test/ndjson-parser.test.ts

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement bounded line parsing**

Implement NdjsonLimits with maxLineBytes and maxEvents. Decode the stream incrementally with a UTF-8 decoder, split both LF and CRLF, count bytes before parsing, discard the remainder of an oversized line, and call diagnostics.recordMalformedMessage() for invalid JSON or invalid message shape. Normalize only the documented type, text, say, ask, and partial fields. Never retain the original object or line.

- [ ] **Step 4: Run parser tests and confirm pass**

Run:

    pnpm exec vitest run packages/cli-driver/test/ndjson-parser.test.ts

Expected: PASS.

- [ ] **Step 5: Write failing transport lifecycle tests**

Use a fake ChildProcessWithoutNullStreams backed by PassThrough streams and an EventEmitter. Assert:

    startNdjsonTransport(options).result resolves succeeded after a valid say message and exit code 0.
    A non-zero exit resolves failed with errorCode process_exit and contains only counters.
    cancel() is idempotent, calls child.kill once, and resolves cancelled even when the child later emits a non-zero exit.
    A timeout resolves timed_out and closes the event queue.
    An ask event with autoApprove false emits kind ask and terminates with permission_unavailable rather than waiting for input.

- [ ] **Step 6: Run transport tests and confirm failure**

Run:

    pnpm exec vitest run packages/cli-driver/test/ndjson-transport.test.ts

Expected: FAIL because startNdjsonTransport does not exist.

- [ ] **Step 7: Implement the NDJSON transport**

Implement startNdjsonTransport to:

    spawn the launch spec through the injected SpawnProcess;
    set phase starting, then running after the child is created;
    consume stdout through consumeNdjsonOutput and count stderr bytes without storing stderr text;
    convert an ask event with autoApprove false into permission_unavailable and invoke cancel();
    start one timer from request.timeoutMs;
    transition to succeeded only for exit code 0 and no protocol/permission failure;
    transition to failed for spawn, parse, protocol, or non-zero exit failures;
    terminate once with child.kill(), wait cancellationGraceMs, and close the queue/result exactly once.

- [ ] **Step 8: Run tests and commit**

Run:

    pnpm exec vitest run packages/cli-driver/test/ndjson-parser.test.ts packages/cli-driver/test/ndjson-transport.test.ts

Expected: PASS. Then run:

    git add packages/cli-driver/src/ndjson-parser.ts packages/cli-driver/src/ndjson-transport.ts packages/cli-driver/test/ndjson-*
    git commit -m "feat: add bounded NDJSON CLI transport"

### Task 4: Implement the ACP v1 host adapter and transport

**Files:**

- Create: packages/cli-driver/src/acp-host.ts
- Create: packages/cli-driver/src/acp-transport.ts
- Create: packages/cli-driver/test/acp-host.test.ts
- Create: packages/cli-driver/test/acp-transport.test.ts

**Interfaces:**

- Consumes ClineCliHost and AcpConnectionFactory from Task 1, plus queue/diagnostic/lifecycle primitives from Task 2.
- Produces buildClientCapabilities(host?: ClineCliHost): acp.ClientCapabilities.
- Produces createAcpClient(host: ClineCliHost | undefined, emit: (event: ClineCliEvent) => void, pending: PendingPermissionRegistry): acp.Client.
- Produces createSdkAcpConnection(options: AcpConnectionOptions): Promise<AcpSessionPort>.
- Produces startAcpTransport(options: AcpTransportOptions): Promise<ClineCliRun>.

- [ ] **Step 1: Write failing host capability tests**

Assert that no host produces no filesystem or terminal capabilities, a read callback advertises only fs.readTextFile, and a complete terminal callback set advertises terminal. Assert the default permission handler selects a reject-once option when one is present and returns cancelled when cancellation is signalled. Assert injected callbacks receive the exact typed ACP request and their responses are returned unchanged.

- [ ] **Step 2: Run host tests and confirm failure**

Run:

    pnpm exec vitest run packages/cli-driver/test/acp-host.test.ts

Expected: FAIL because the ACP host module does not exist.

- [ ] **Step 3: Implement typed host capability mapping**

Implement buildClientCapabilities so it sets fs.readTextFile and fs.writeTextFile only for supplied callbacks and sets terminal true only when createTerminal, terminalOutput, releaseTerminal, waitForTerminalExit, and killTerminal are all supplied. Register the SDK request handlers with the corresponding methods in @agentclientprotocol/sdk. Always register requestPermission; missing permission callback returns a reject_once option or cancelled outcome and never auto-approves. Track pending permission promises so cancellation can resolve every pending request with the ACP cancelled outcome.

- [ ] **Step 4: Run host tests and confirm pass**

Run:

    pnpm exec vitest run packages/cli-driver/test/acp-host.test.ts

Expected: PASS.

- [ ] **Step 5: Write failing ACP transport tests using a fake connection factory**

Define a fake AcpConnectionFactory that records cwd, host capabilities, and markSessionStarted calls, emits update and stop messages, and exposes cancel/dispose counters. Assert:

    initialization success creates a running ACP handle and emits normalized message/tool/plan events;
    a stop reason end_turn plus child exit 0 resolves succeeded with transport acp;
    a factory error before markSessionStarted is classified acp_unavailable;
    cancel() calls the ACP session cancel operation, resolves pending permission requests, and wins over a later non-zero child exit;
    timeout follows the same path but resolves timed_out;
    diagnostics contain only counts and phase metadata.

- [ ] **Step 6: Run ACP transport tests and confirm failure**

Run:

    pnpm exec vitest run packages/cli-driver/test/acp-transport.test.ts

Expected: FAIL because startAcpTransport and the SDK connection factory do not exist.

- [ ] **Step 7: Implement the official SDK connection factory**

Implement createSdkAcpConnection using only @agentclientprotocol/sdk v1:

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );

    const app = acp.client({ name: 'cline2api', version: '0.1.0' })
      .onRequest(acp.methods.client.session.requestPermission, permissionHandler)
      .connectWith(stream, async (ctx) => {
        await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: buildClientCapabilities(host),
          clientInfo: { name: 'cline2api', version: '0.1.0' },
        });
        const session = await ctx.buildSession(cwd).start();
        markSessionStarted();
        return session;
      });

Keep the active session and client context in a small port object. Implement prompt with ActiveSession.prompt, updates with ActiveSession.nextUpdate, and cancellation with ctx.notify(acp.methods.agent.session.cancel, { sessionId }). Dispose the ActiveSession and close the child exactly once. Classify only spawn/initialize failures before markSessionStarted as acp_unavailable; authentication, session, prompt, and callback failures remain terminal run errors.

- [ ] **Step 8: Implement ACP transport lifecycle and run tests**

Implement startAcpTransport with the same result, queue, timeout, cancellation grace, and child-exit rules as NDJSON. Ensure the process result cannot overwrite cancelled or timed_out. Run:

    pnpm exec vitest run packages/cli-driver/test/acp-host.test.ts packages/cli-driver/test/acp-transport.test.ts

Expected: PASS. Then commit:

    git add packages/cli-driver/src/acp-host.ts packages/cli-driver/src/acp-transport.ts packages/cli-driver/test/acp-*
    git commit -m "feat: add ACP v1 CLI transport"

### Task 5: Add the ACP-first orchestrator and package exports

**Files:**

- Create: packages/cli-driver/src/driver.ts
- Create: packages/cli-driver/src/index.ts
- Create: packages/cli-driver/test/driver.test.ts
- Modify: packages/cli-driver/src/types.ts if the exported option interfaces need final import wiring

**Interfaces:**

- Consumes startAcpTransport, startNdjsonTransport, AcpUnavailableError, and the common public types from Tasks 1–4.
- Produces createClineCliDriver(options?: ClineCliDriverOptions): ClineCliDriver.
- Exports createClineCliDriver, all public request/result/event/host types, and ClineCliError from src/index.ts.

- [ ] **Step 1: Write failing orchestrator tests**

Inject fake ACP and NDJSON starters through the driver options. Assert:

    auto calls ACP only when ACP creates a session successfully;
    auto calls ACP then NDJSON exactly once when ACP throws AcpUnavailableError before markSessionStarted;
    auto does not call NDJSON for authentication_required, permission_unavailable, protocol_error, timeout, or cancelled failures;
    explicit acp never calls NDJSON;
    explicit ndjson never calls ACP;
    invalid requests fail before either starter is called.

- [ ] **Step 2: Run orchestrator tests and confirm failure**

Run:

    pnpm exec vitest run packages/cli-driver/test/driver.test.ts

Expected: FAIL because createClineCliDriver does not exist.

- [ ] **Step 3: Implement the orchestrator**

Implement createClineCliDriver with default executable cline, default transport auto, and injected process/ACP factories. Validate the request before spawning. For auto, await the ACP starter only until it either returns a handle or throws AcpUnavailableError; on that one error, start NDJSON with the same validated request and limits. Preserve all other errors and never start a second child. Merge driver defaults with request overrides without mutating either object.

- [ ] **Step 4: Run orchestrator and complete package tests**

Run:

    pnpm exec vitest run packages/cli-driver/test

Expected: PASS for launch, queue, diagnostics, lifecycle, parser, NDJSON, ACP host, ACP transport, and orchestrator tests. Then run:

    git add packages/cli-driver/src/driver.ts packages/cli-driver/src/index.ts packages/cli-driver/test/driver.test.ts packages/cli-driver/src/types.ts
    git commit -m "feat: add ACP-first Cline CLI driver"

### Task 6: Integrate the package into the Harness and verify the feature

**Files:**

- Modify: package.json only if a focused cli test script is useful
- Modify: tsconfig.json and package references if Task 1 left any project-reference wiring incomplete
- Modify: .harness/feature_list.json
- Modify: .harness/progress.md
- Modify: .harness/session-handoff.md
- Modify: .harness/quality-document.md
- Modify: .harness/clean-state-checklist.md only if the checklist needs the new focused command

**Interfaces:**

- Consumes the exported @cline2api/cli-driver package and its complete test suite.
- Produces redacted Harness evidence that is sufficient to mark CLI-001 passing, or records an exact blocker without changing the status to passing.

- [ ] **Step 1: Run the feature verification suite before state edits**

Run:

    pnpm exec vitest run packages/cli-driver/test
    pnpm verify
    CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store HARNESS_SKIP_INSTALL=1 pnpm harness:init
    git diff --check

Expected: all focused tests pass, verify passes, harness init exits 0, and diff check is clean. If any command fails, keep CLI-001 in_progress and record the redacted command/output and next action in progress.md.

- [ ] **Step 2: Record exact feature evidence**

Update CLI-001 verification to:

    pnpm exec vitest run packages/cli-driver/test
    pnpm verify
    CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store HARNESS_SKIP_INSTALL=1 pnpm harness:init
    git diff --check

Set status to passing only when every command above passes. Record test counts, exit codes, ACP-first/fallback coverage, and the absence of raw secrets/provider payloads. Do not write a live Cline token, prompt, response, or stderr line into evidence.

- [ ] **Step 3: Update progress, handoff, and quality snapshot**

Set progress current branch and active feature to the actual verified branch. Record the focused commands, the final commit IDs, the known sandbox pnpm store limitation, and the next feature API-001. In quality-document.md, replace CLI boundary 'Not assessed' with a grade justified by the recorded ACP/NDJSON lifecycle evidence; leave cross-platform CI as the next check if it was not run. Update session-handoff.md with verified behavior, remaining risks, and the next best action.

- [ ] **Step 4: Run final verification and inspect the diff**

Run:

    pnpm format:check
    pnpm typecheck
    pnpm test
    pnpm exec vitest run packages/cli-driver/test
    git diff --check
    git status --short

Expected: all commands pass and only intentional CLI-001 changes remain.

- [ ] **Step 5: Commit the Harness evidence**

Run:

    git add .harness package.json tsconfig.json pnpm-lock.yaml packages/cli-driver
    git commit -m "chore: record CLI-001 verification evidence"

Expected: the working tree is clean and the feature state is consistent with the command evidence.

## Self-review checklist

1. Spec coverage: Task 1 covers public request/host/launch contracts; Task 2 covers bounded diagnostics, async events, and monotonic terminal states; Task 3 covers documented NDJSON parsing and lifecycle; Task 4 covers ACP v1, callbacks, permissions, session updates, cancellation, and timeout; Task 5 covers explicit transport selection and pre-session-only fallback; Task 6 covers cross-platform verification, Harness evidence, and handoff.
2. Placeholder scan: the plan contains no unassigned placeholder steps, no vague 'handle edge cases' instructions, and no task that depends on an unnamed function.
3. Type consistency: ClineCliRequest, ClineCliRun, ClineCliResult, ClineCliHost, LaunchSpec, SpawnProcess, AcpConnectionFactory, AcpConnectionOptions, AcpSessionPort, AsyncQueue, BoundedDiagnostics, and RunPhase are introduced before consumers use them. The exported createClineCliDriver is introduced in Task 5 and is only referenced by Task 6.
4. Safety review: the plan does not add a local host bridge, does not pass API keys through the public request, does not use shell execution, and only allows NDJSON fallback before ACP session creation.

# cline2api

Production-grade provider adapter architecture that exposes the official Cline CLI to existing AI routers and coding systems through an OpenAI-compatible, streaming-first interface.

cline2api is not an AI router and does not reverse engineer Cline or ClinePass internal protocols. The first commit establishes the cross-platform Production Harness and TypeScript monorepo baseline; provider execution and router integrations are tracked as later features.

## Requirements

- Node.js 24 or newer
- pnpm 11 or newer
- Git
- An official Cline CLI installation for future CLI integration features

## Quick start

```bash
git clone <repository-url> cline2api
cd cline2api
pnpm install
pnpm harness:init
```

The sandbox-specific store override is only needed when `/root/.local` is not writable:

```bash
CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store pnpm harness:init
```

## Commands

| Command             | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `pnpm harness:init` | Validate state, install dependencies, and run verification |
| `pnpm verify`       | Run formatting, typecheck, and all tests                   |
| `pnpm test`         | Run Vitest once                                            |
| `pnpm test:watch`   | Run Vitest in watch mode                                   |
| `pnpm build`        | Build referenced TypeScript packages                       |
| `pnpm format`       | Format repository files                                    |
| `pnpm format:check` | Check formatting without modifying files                   |

## Development workflow

Read `AGENTS.md` before making changes. Read `.harness/progress.md` and `.harness/feature_list.json`, work on exactly one feature, use TDD, record evidence, and complete the clean-state checklist before ending a session.

## Current foundation

- `HARN-001`: Production Harness bootstrap and self-validation
- `CORE-001`: Monorepo and TypeScript toolchain baseline
- Future features: official Cline CLI lifecycle, OpenAI-compatible API/streaming, secret redaction, plugin SDK, and adapters for 9Router, OmniRoute, and OpenCodeX

## License

MIT

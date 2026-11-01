# Development conventions

[简体中文](development.zh-CN.md) · [Project overview](../README.md)

Application modules use TypeScript/TSX while retaining React, Vite, Node 24, Express and SQLite. Vite builds the browser application. Node runs backend `.ts` modules using native type stripping; the runtime image requires neither a TypeScript compiler nor a TS runner.

## Structure

| Directory | Responsibility |
| --- | --- |
| `src/main.tsx`, `src/app/` | React entry, session and workspace coordination |
| `src/components/ui/`, `src/components/brand/` | Reusable UI primitives and branding |
| `src/features/<feature>/components/` | Auth, appearance, chat, files, memos, notifications, resources, settings, terminal and workspace UI |
| `src/features/<feature>/lib/` | Feature-specific pure logic |
| `src/hooks/`, `src/lib/`, `src/types/` | Shared browser hooks, transports and environment types |
| `src/styles/` | Global styles and design variables |
| `server/index.ts`, `server/app.ts` | Process lifecycle and injectable HTTP/WS application factory |
| `server/{appearance,chat,codex,db,files,resources,workspace}/` | Gateway domain adapters |
| `shared/contracts/` | Domain, API, protocol and error types |
| `shared/{chat,files,platform,resources,settings,workspace}/` | Browser/server shared logic |
| `test/`, `scripts/` | Behavioral/type regressions and development/operations tooling |

Shared modules must not import browser or gateway application layers. The gateway must not import browser modules. UI primitives must not import business features. `check:architecture` enforces these boundaries, explicit relative module paths and TS/TSX application sources.

Use PascalCase `.tsx` component names, `use` hook names, `.ts` logic modules, explicit relative file extensions and `import type`. Backend/shared modules use erasable TS syntax: avoid enums, parameter properties and runtime namespaces. Keep feature-local code with its feature; promote a component into shared UI only when it has no business dependency.

Application-owned roles, settings, files, tabs, sessions and component props have domain types. Extensible CLI/tool JSON and dynamic SQL rows retain explicit adapter boundaries. `ProtocolRecord` does not validate data or imply exhaustive protocol modeling. New business logic should introduce concrete DTOs and runtime guards. Preserve authentication, role revocation, quotas, path protection, binary WebSocket uploads, reconnect and scroll behavior during structural refactors.

## Commands

Install with `npm ci` on Node 24. Some archive tests require libarchive `bsdtar`/`bsdcat`; Linux-specific isolation/deployment cases skip on Windows.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run dev:web` | Backend watch / Vite development server |
| `npm run typecheck` | Strict application type checking without emitted files |
| `npm run check:architecture` | Dependency and module conventions |
| `npm run check:runtime` | Native Node type stripping and syntax checks; no dev dependencies |
| `npm run check` | All application checks |
| `npm run test:types` | Positive and expected-negative contract checks |
| `npm test` | HTTP/WS, filesystem, permissions, protocol and pure-logic regressions |
| `npm run build` | Production frontend bundle |
| `npm run format` / `npm run format:check` | Format / check formatting |
| `npm run validate` | Formatting, application checks, type contracts, tests and build |

Run the backend and Vite in separate terminals. Vite proxies `/api` and `/ws` to `127.0.0.1:3100`; configure backend `PUBLIC_URL` to match the browser's Vite origin, such as `http://127.0.0.1:5173`, or origin checks will reject requests. Use separate development data. Alternatively, build and run `npm start` to serve the production bundle through the backend port.

Run `npm run validate` before submitting changes. Test relevant desktop/mobile, light/dark, keyboard/touch and lazy-loaded flows in a browser. Types and formatting do not replace behavior tests.

## CI and runtime packaging

The PR Quality checks workflow validates development sources without deployment permissions. Production deployment remains manually triggered.

Docker typechecks and builds before pruning development dependencies. Candidate images run only `npm run check:runtime`, exclude tests/frontend sources/the compiler, and retain startup, health, revision and rollback gates. Native type stripping may emit an experimental warning on Node 24. Existing build resource limits and scoped cache cleanup remain in place.

# ADR-0001: Surge lives in `@cline/surge`

## Status

Accepted (recommended default for Drivecode).

## Context

MOS documents Surge under `mos-core` as Python parallel orchestration (executor, memory bus, mailbox, checkpoints, review gates, AIMD, rate limiting). Drivecode needs the same capability without embedding a Python runtime or conflating it with Drive seating or Cline Teams.

## Decision

1. Create `sdk/packages/surge` published as `@cline/surge`.
2. Keep the package free of `@cline/drive`, `@cline/agents`, and `@cline/core` dependencies.
3. Execute work through `SurgeHostPort` so hosts bind Copilot/Cursor/Cline agents at the edge.
4. Do not put Surge under `@cline/drive` (Drive stays a pure collaboration kernel).
5. Do not put Surge under `@cline/agents` (agents stay a single-loop runtime).

## Consequences

- Drive and Teams can both consume Surge without circular imports.
- A later MOS bridge can wrap the same types without forking the domain model.
- Hosts must supply `runTask`; the framework will not call providers directly.

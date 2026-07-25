# `@cline/surge`

TypeScript Surge framework for parallel, gated, resumable orchestration inside the Cline SDK monorepo.

Inspired by the MOS (Modular Orchestration System) Surge layer. This package is the Drivecode-native substrate: waves of tasks, review gates, shared memory, mailbox, AIMD concurrency, queued rate limiting, and checkpoints.

## Install / build

Workspace package. From repo root:

```sh
bun install
bun -F @cline/surge build
bun -F @cline/surge test
```

## Quick start

```ts
import { SurgeWorkflowRunner } from "@cline/surge";

const result = await new SurgeWorkflowRunner({
  host: {
    async runTask({ task }) {
      return { ok: true, result: { kind: task.kind } };
    },
  },
}).run([
  { id: "a", kind: "edit" },
  { id: "b", kind: "edit" },
  { id: "c", kind: "test", dependsOn: ["a", "b"] },
]);

console.log(result.status, result.wave, result.tasks.length);
```

## Docs

- [Architecture](../../../docs/plans/surge/00-architecture.md)
- [ADR: package boundary](../../../docs/plans/surge/ADR-0001-package-boundary.md)

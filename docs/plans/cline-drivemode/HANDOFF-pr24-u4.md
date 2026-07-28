# Handoff · PR 24 (U4 AI SDK 7)

**Reader.** Next agent or human continuing from a fresh chat.  
**Repo.** `hhalperin/cline-drivecode` (local: `profiles/hhalperin/active/cline-drivecode`).  
**PR.** https://github.com/hhalperin/cline-drivecode/pull/24 (draft)  
**Branch.** `cursor/ai-sdk-u4-bc-6054bdb8-2911-4f91-80f9-852910862680`  
**Parent plan.** Dependency upgrades + primitives audit (`docs/plans/cline-drivemode/13-deps-inventory.md`, `14-primitives-audit.md`).

## Already on main (do not redo)

- **PR 23** squash-merged: Drive BYOK/topology/director, hub `drive.*` + `call_*`, ConversationPanel split, Biome 2.5.5, Zod 4.3.6, hub lucide 1.27, etc. Tip at merge: `40b795f5f`.

## What PR 24 already contains

| Item | Status |
|---|---|
| `ai` → `^7.0.40` (`@cline/llms`, hub webview, vscode example) | Done |
| `@ai-sdk/anthropic|openai|google|mistral|provider|…` majors aligned | Done |
| `LanguageModelV3` → `LanguageModelV4` renames in middleware/vendors | Done |
| `streamText`: `experimental_telemetry` → `telemetry`; omit empty `tools` | Done |
| `bun run build:sdk` | Green at tip |
| `bun -F @cline/llms test` | **420 passed** at tip |

## Must finish before merging PR 24

### U4-A · Rewrite `split-tool-images` for LanguageModelV4 (blocking)

**File.** `sdk/packages/llms/src/providers/middleware/split-tool-images.ts`  
**Problem.** File starts with `// @ts-nocheck` because V4 `LanguageModelV4ToolResultOutput` no longer has `image-data` / `image-url` / `file-data` / `file-url` / `image-file-id` content parts. V4 outputs are roughly: `text` | `json` | `execution-denied` | `error-text` | `error-json` | (and related). Media now flows through file/`LanguageModelV4FilePart` differently.

**Acceptance.**

1. Remove `@ts-nocheck`.
2. Middleware compiles under strict `tsc` with V4 types.
3. `split-tool-images.test.ts` updated for V4 shapes; keep coverage for: tool result with embedded images → rewritten prompt with file parts; no-op when no media; openai-compatible / mistral / ollama wrap paths still attach middleware.
4. `bun -F @cline/llms test` green; `bun run build:sdk` green.
5. Smoke: tool result that returns an image (or fixture) still reaches the model as multimodal content on openai-compatible path.

**Refs.** AI SDK 7 migration guide; `@ai-sdk/provider` `LanguageModelV4ToolResultOutput` / `LanguageModelV4FilePart`.

### U4-B · Clear remaining `experimental_*` / deprecation warnings (should land with 24)

| Item | Where | Notes |
|---|---|---|
| `experimental_repairToolCall` | `sdk/packages/llms/src/providers/ai-sdk.ts` | Still passed to `streamText`; migrate to non-experimental API if renamed in v7 (`repairToolCall` / docs). |
| Deprecation: providerOptions key `'openai-compatible'` → `'openaiCompatible'` | Runtime warnings in llms tests | Routing already emits `openaiCompatible` in many paths; hunt remaining `'openai-compatible'` option buckets that still warn. |
| Peer packages | `ai-sdk-ollama`, `ai-sdk-provider-opencode-sdk`, `dify-ai-provider`, SAP provider | Confirm peer ranges work with `ai@7`; bump or pin with documented incompatibility. |

### U4-C · Verify consumers (should land with 24)

| Check | Command / action |
|---|---|
| Hub webview build | `bun -F @cline/cline-hub build:webview` |
| Hub tests | `bun -F @cline/cline-hub test` |
| Core typecheck/tests touching stream | `bun -F @cline/core test` (or scoped hub/llms paths) |
| VCR suite | `bun -F @cline/llms test:vcr` if API keys/cassettes available |
| Live smoke (optional) | `bun -F @cline/llms test:live` only with credentials |

### U4-D · PR hygiene before merge

1. Mark PR 24 ready-for-review (undraft) once U4-A–C green.
2. Confirm CI on the branch: Quality Checks + sdk-test matrix.
3. Do **not** pull vscode Vite 8 / React 19 into this PR (see out-of-scope).

## Explicitly out of scope for PR 24 (follow-up PRs)

| ID | Work | Why separate |
|---|---|---|
| U2b | vscode `webview-ui` Vite 7 → 8 (rolldown `OutputOptions` / `defineConfig`+`test`) | Broke `ci:build` / e2e when tried on PR 23 |
| U2c | vscode `webview-ui` React 18 → 19 | Extension host / JCEF constraints |
| U5b | vscode `lucide-react` 0.511 → 1.x | Hub/desktop already on 1.27; vscode needs icon audit |
| U6 | Broad `bun update` transitive bumps | Needs scoped review |
| TS 7 | TypeScript 5.9 → 7 | Inventory: stay on 5.9 until planned |
| Drive product | Demo share producers beyond mermaid stub, mic wiring, WebRTC, recruit/graph | Separate drivemode feature PRs; see `docs/plans/cline-drivemode/HANDOFF.md` |

## Suggested implementation order (PR 24 only)

```text
1. U4-A  rewrite split-tool-images (+ tests) — remove @ts-nocheck
2. U4-B  experimental_repairToolCall + providerOptions deprecations + peers
3. U4-C  hub/core consumer verify + VCR
4. U4-D  undraft, CI green, squash-merge
```

## Commands (quick)

```bash
# From repo root — Bun only
git fetch origin main
git checkout cursor/ai-sdk-u4-bc-6054bdb8-2911-4f91-80f9-852910862680
git pull origin cursor/ai-sdk-u4-bc-6054bdb8-2911-4f91-80f9-852910862680

bun install
bun run build:sdk
bun -F @cline/llms test
bun -F @cline/cline-hub build:webview
bun -F @cline/cline-hub test
```

## Risk notes

- Multimodal tool-result images on openai-compatible / mistral / ollama are the highest regression surface until U4-A is done.
- Do not “fix” by deleting the middleware; vendors depend on it for tool-role image recovery.
- Prefer smallest diff that restores typed V4 behavior; no drive-feature scope creep on this PR.

## Related docs

- Inventory: [`13-deps-inventory.md`](13-deps-inventory.md)
- Primitives audit (mostly done on main): [`14-primitives-audit.md`](14-primitives-audit.md)
- Broader Drive product handoff: [`HANDOFF.md`](HANDOFF.md)
- AI SDK 7 migration: https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0

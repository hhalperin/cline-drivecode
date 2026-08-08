# org-migration · inventory

Measured 2026-08-08 against `hhalperin/cline-drivecode@403fc6b` and the live
GitHub API. Back to [README](README.md).

Everything on this page is reproducible. Where a claim came from a command, the
command is shown — a stale inventory that reads as current is worse than no
inventory.

## The two repos

| | `hhalperin/cline-drivecode` | `drive-mode/cline-drivecode` |
|---|---|---|
| Created | — | 2026-07-30 |
| Visibility | public | public |
| `fork` | (of `cline/cline`) | **`true`** — of the personal repo |
| `main` tip | `403fc6b` (#226) | `f94c7c7` (#148) |
| Last push | current | 2026-08-03 |
| Open PRs | active | 0 (one closed: #1) |
| Default branch | `main` | `main` |

### Divergence: none

```console
$ git merge-base --is-ancestor org/main origin/main && echo ancestor
ancestor
$ git rev-list --count org/main..origin/main
81
$ git rev-list --count origin/main..org/main
0
```

`org/main` is a **strict ancestor**. The sync is `git push org main` — a
fast-forward, no merge commit, no conflict, no rewrite.

> **Clone depth caveat.** A shallow clone reports these two histories as
> unrelated (no merge base) and inverts the direction — 7 109 "org-only"
> commits, which is just upstream Cline history the shallow clone never
> fetched. Run `git fetch --unshallow origin` before trusting any comparison.
> This cost an hour; it is written down so it costs nobody else one.

### What the 81 commits carry

| Area | Count | Notable |
|---|---|---|
| `feat(drive)` | 15 | Editable Driveagent config-as-code (#185), durable artifact corpus (#174), per-agent appearance (#181) |
| `feat(hub-webview)` | 9 | Tasks page + dependency map viewport (#182, #175), Artifacts page (#178), PiP Partner (#188), agent profile page (#190) |
| `docs(drivecode)` / `docs(drive)` | 19 | ADR-0025/0027, ADR-0030…0035 drafts, decision changelog + coverage |
| `fix(core)` | 5 | Delegated tool-authority capping (#195 and predecessors) |
| `refactor(core)` / `refactor(hub)` | 4 | Index-cycle breaks (#151, #152, #153) |
| `ci(drive)` | 2 | Stack-safe docs/sdk CI (#193), hub webview typecheck gate (#171) |
| Merges | 3 | — |

The two consumer-facing ones matter for this plan: **#216** (`?app=1` MC1
Join/Continue home) and **#217** (consumer path MC1–MC3 + the iOS fixture demo)
are both in this set. **The org repo does not currently contain the mobile
consumer shell at all.** Phase 1 is a prerequisite for phase 5, not a parallel
track.

## CI on the org fork — 28 runs, 23 of them scheduled

All 26 workflows are `state: active` on the fork. In the five days after the
last push, with nobody working in the repo:

| Workflow | Runs | Conclusion |
|---|---|---|
| Publish Combined Nightly (`ext-vscode-publish-nightly`) | 6 | skipped |
| `cli-publish` | 6 | skipped |
| `sdk-publish` | 5 | 4 success, **1 failure** (2026-08-04) |
| `repo-stale-issues` | 5 | success — **this one actually runs** |
| `docs-link-check` | 2 | success |
| `drive-ci`, `sdk-test`, `ext-vscode-test`, `ext-vscode-test-e2e` | 1 each | success (the 2026-08-03 push) |

Two separate problems live in that table.

**The publish workflows are guarded, but scheduled.** `cli-publish`,
`sdk-publish`, `ui-publish`, `desktop-publish`, and `ext-vscode-publish-nightly`
all carry `if: github.repository == 'cline/cline'`, so they cannot publish from
here. They still wake on cron, burn minutes, and post a conclusion. A repo about
to become a public product front door should not have a daily red/green signal
driven by workflows that are structurally incapable of doing anything.

**`repo-stale-issues` is not guarded.** It succeeds because there are no issues
yet. The moment the org repo has any, it starts closing them on upstream Cline's
schedule and policy, which nobody here chose.

### The release path is guarded *against* the org

`.github/workflows/drive-beta-release.yml` — the only release path for the
self-hosted beta:

```yaml
jobs:
  verify:
    if: github.repository == 'hhalperin/cline-drivecode'
  tag-and-draft:
    if: github.repository == 'hhalperin/cline-drivecode' && inputs.confirm == 'tag'
```

Dispatched from the org today, both jobs skip and the run reports **success**.
Nothing tells you the release did not happen. The comment above the guard —
"Only this fork. A fork-of-a-fork inherits the workflow but not the intent" —
is correct reasoning that now points at the wrong repo.

Its generated release notes hand a tester:

- `git clone --branch $TAG https://github.com/hhalperin/cline-drivecode.git`
- three `https://github.com/hhalperin/cline-drivecode/blob/$TAG/...` doc links

## The reference surface: 45 refs, 24 files

```console
$ grep -rn "hhalperin/cline-drivecode" --include="*" . | grep -v node_modules | wc -l
45
```

| Tier | Files | Why it is this tier |
|---|---|---|
| **Blocking** — a tester hits it | `.github/workflows/drive-beta-release.yml` (6), `docs/drivecode/reference/install.md` (2), `README.md` (1), `docs/drivecode/plans/cline-drivemode/ops/beta-support.md` (1) | Clone URL, install path, support path |
| **Should follow** — current planning truth | `AGENTS.md` (1), `delivery/BACKLOG.md` (6), `delivery/MVP-beta.md` (1), `delivery/HANDOFF.md` (1), `leadership/LEADERSHIP-BRIEF.md` (1), `adr/ADR-0016` (1), `adr/ADR-0023` (1), `research/12`, `research/25` (3), `features/DRV-CHAT-FORK.md` (1), `initiatives/hosted-preview`, `initiatives/share-and-router` (2), `design/wireframes/DEMO.md` (1) | Read by the next agent as fact |
| **Leave alone** — history | `archive/HANDOFF-pr24-u4.md` (2), `meta/reviews/*` (3), `plans/drivecode-sdk/delivery/07,08,09` (9), `assets/changelog/repo-changelog.json` (2) | Archived handoffs and review narratives describe what was true then. `repo-changelog.json` is **generated** — regenerate, do not edit |

`plans/drivecode-sdk/delivery/07-agent-handoff.md` is already marked historical
by [HANDOFF.md](../../../../HANDOFF.md) and carries 6 of the 9 archive-tier refs.

## Cross-repo promises already made

| Where | Says |
|---|---|
| `drive-mode/site` `README.md` | "[Cline Drive](https://github.com/hhalperin/cline-drivecode) (moving to `drive-mode` shortly)" |
| [hosted-preview](../hosted-preview/README.md) open Q2 | "If `cline-drivecode` moves org, every link and the CI deploy credentials move with it — worth sequencing against this plan rather than in parallel" |
| [hosted-preview](../hosted-preview/README.md) "Which repo owns what" | `site` owns infrastructure; the product repo owns the artifact; the handshake is a published build artifact, **not** a vendored `dist/` |

That third row is a decision this plan inherits rather than re-opens: phase 4
does not commit a bundle into `site`.

## Physical facts that shape the runbook

| Fact | Consequence |
|---|---|
| `.git` is **149 MB**; largest blobs are upstream docs GIFs (9.4 MB, 6.4 MB) and `catalog.generated.ts` (2.1 MB) | Delete-and-re-push (option C) means one 149 MB push. Do it **before** the sync, not after |
| `.gitattributes` marks `demo.gif` / `assets/docs/demo.gif` as **LFS** | An LFS-aware push needs the objects. Verify LFS on the destination before declaring phase 1 done |
| `.gitmodules` → `evals/cline-bench` from `cline/cline-bench` | Public upstream, unaffected by the org move. `install.md` already says not to recurse |
| `package.json` pins Bun **1.3.13**; this environment has **1.3.11** | Not a migration blocker, but it is the first thing a tester following `install.md` hits. Worth a preflight note in phase 3 |
| `.github/CODEOWNERS` names `@saoudrizwan @arafatkatze @maxpaulus43 @dominiccooney` | Inherited from upstream. In the org these become real review requests to people with no relationship to this fork |

## The other org repos

| Repo | Visibility | State | Relationship to the move |
|---|---|---|---|
| `site` | private | Live at `drivemode.ai`; hand-authored static, `dist/` is the artifact; **no tracked CI** — deploys are manual `wrangler` | Owns phase 4. Its `_headers` sets `microphone=()` site-wide, which is fatal for Drive and already flagged in [hosted-preview](../hosted-preview/README.md) |
| `drivemode-mcp` | private | v0 writer + viewer + MCP stdio; packs `coding`, `demo-ops` | Phase 6 |
| `collaboration-harness` | private | v0 protocol + kernel + host port; `@drive-mode/collaboration-harness` | Phase 6. Depends on `drivemode-mcp` being a **sibling clone** (`file:../../../collaboration-harness`) |
| `cursor-drive` | public | Sibling product | None |
| `claude-drive` | private | Sibling product | None |

Four of the five are **private** while `cline-drivecode` is **public** — worth a
deliberate look at phase 1 rather than discovering it when a link 404s for
someone outside the org.

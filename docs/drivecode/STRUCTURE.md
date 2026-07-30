# docs/drivecode — directory skeleton

Plan for how this nest should be organized. **Not yet migrated** — current
paths still apply until a move is executed. Use this as the placement contract
when adding or sorting docs.

## Diagnosis (current ~187 files)

| Problem | Evidence |
|---|---|
| Flat dump under product plans | `plans/cline-drivemode/` mixes foundation docs, research, leadership, handoffs, smoke tests, and initiative folders at one level |
| Role collision at nest root | Shipped reference (`architecture.md`) sits beside process (`HANDOFF.md`, `CI.md`, `AGENTS.md`) |
| Duplicate front doors | Nest `HANDOFF.md` and `plans/cline-drivemode/HANDOFF.md` (plus PR-scoped handoffs) |
| Glossary mis-homed | `reviews/glossary.md` is not a PR review |
| Assets unsorted | Hub, TUI, logos, and demo PNGs share one flat `assets/` |
| Design is one bucket | Brand tokens, HTML wireframes, canvases, and variant PNGs share `design/drive-wireframes/` |
| Initiative vs feature ambiguity | Some work is `features/DRV-*.md` only; larger tracks get sibling dirs (`show-backlog-director/`, `task-bank-drive-loop/`) with no named parent |
| Overlapping topic stubs | Numbered notes like `09-demo-share.md` sit beside fuller `share-and-router/` |

## Design rules

1. **Sort by document role**, then by track (product vs harness). Role answers “what kind of work is this?” Track answers “which codebase plan owns it?”
2. **One front door per job.** Nest root: product reference index, agent rules, cold-start handoff, CI contract, this skeleton. No second nest-level HANDOFF.
3. **Keep stable track ids.** Retain folder names `plans/cline-drivemode/` and `plans/drivecode-sdk/` (many absolute links). Reorganize *inside* them.
4. **Initiatives are multi-file delivery plans** under `initiatives/`. Single-feature specs stay `features/DRV-*.md`. An initiative may cite one or more DRV ids.
5. **Archive stale session artifacts**; do not delete history that still explains a merged PR.
6. **Assets and design split by surface**, not by date.
7. Prefer an existing leaf over inventing a new top-level sibling of `plans/`, `design/`, `assets/`, `meta/`.

## Target skeleton

```text
docs/drivecode/
├── README.md                 # shipped product reference (cite live code)
├── AGENTS.md                 # add / edit / maintain rules
├── HANDOFF.md                # sole nest-level cold-start brief
├── CI.md                     # path filters, gate, labels
├── STRUCTURE.md              # this file — placement contract
│
├── reference/                # optional peel-out of long reference pages
│   ├── architecture.md       #   (may stay at nest root until move)
│   ├── native-vs-drivecode.md
│   └── skills-inventory.md
│
├── plans/
│   ├── README.md             # index of tracks only
│   ├── cline-drivemode/      # product plan track (stable id)
│   │   ├── README.md         # plan index + feature table
│   │   ├── foundation/       # north-star numbered series
│   │   │   ├── 00-vision.md
│   │   │   ├── 01-architecture.md
│   │   │   ├── 05-workflows.md
│   │   │   ├── 06-platform-config.md
│   │   │   ├── 07-runtime-topology.md
│   │   │   └── 08-provider-harness.md
│   │   ├── research/         # prior art, inventory, audits, futures
│   │   │   ├── 02-research-streaming.md
│   │   │   ├── 03-research-inventory.md
│   │   │   ├── 04-future-multi-user.md
│   │   │   ├── 12-performance.md
│   │   │   ├── 13-deps-inventory.md
│   │   │   └── 14-primitives-audit.md
│   │   ├── leadership/       # SE/PM planning wave (not day-to-day eng)
│   │   │   ├── LEADERSHIP-BRIEF.md
│   │   │   ├── SYSTEMS-ANALYSIS.md
│   │   │   ├── CHECKLIST-phase0-entry.md
│   │   │   └── MATRIX-workflow-coverage.md
│   │   ├── delivery/         # how agents execute the plan
│   │   │   ├── TASK-GRAPH.md
│   │   │   ├── AGENT-RUNBOOK.md
│   │   │   └── HANDOFF.md    # track-scoped active handoff (optional)
│   │   ├── decisions/        # DEC-* leadership decisions
│   │   ├── ard/              # ARD-NNNN-* + status board
│   │   ├── prd/              # product requirements
│   │   ├── features/         # DRV-*.md one-pagers
│   │   ├── initiatives/      # multi-file implementation plans
│   │   │   ├── README.md     # id → DRV link → status
│   │   │   ├── show-backlog-director/
│   │   │   ├── task-bank-drive-loop/
│   │   │   ├── share-and-router/      # absorb 09–11 stubs or link them
│   │   │   └── share-screen-canvas/
│   │   ├── schemas/          # Phase 0 schema index / freezes
│   │   ├── examples/         # fixtures (e.g. .driveagent homes)
│   │   ├── ops/              # runbooks + smoke notes
│   │   │   ├── hub-drive-ops.md
│   │   │   ├── local-stt.md
│   │   │   ├── smoke-voice-local.md
│   │   │   └── smoke-voice-cloud.md
│   │   └── archive/          # closed session handoffs (HANDOFF-pr*.md)
│   └── drivecode-sdk/        # harness / host-port track (stable id)
│       ├── README.md
│       ├── foundation/       # 00–05 numbered series (optional split)
│       ├── delivery/         # 06 leverage, 07 handoff, 08 follow-on
│       └── decisions.tsv
│
├── design/
│   ├── README.md
│   ├── brand/
│   │   └── CLINE-BRAND-TOKENS.md
│   ├── wireframes/           # interactive HTML + DRIVE-TAB.md + DEMO.md
│   │   ├── DRIVE-TAB.md
│   │   ├── DEMO.md
│   │   ├── index.html
│   │   ├── drive-tab-discord-slack.html
│   │   └── variants/         # variant-a/b/c.png
│   └── canvases/
│       ├── overview-canvas.html
│       └── share-screen-canvas.html
│
├── assets/
│   ├── logos/                # logo-*.png
│   ├── hub/                  # drive-*.png, status-*.png
│   ├── tui/                  # tui-*.png
│   └── demos/                # share-screen-spotlight-*.png
│
└── meta/
    ├── glossary.md
    └── reviews/              # PR review writeups
        └── PR-*.md
```

`reference/` is optional. If link churn is high, keep `architecture.md`,
`native-vs-drivecode.md`, and `skills-inventory.md` at nest root and treat them
as the reference set in `AGENTS.md` without a subdirectory.

## Placement matrix (where new work goes)

| You are writing… | Put it here |
|---|---|
| Shipped behavior cited to live code | Nest `README.md` or `reference/` |
| Agent maintain rules / CI contract / skeleton | Nest root (`AGENTS.md`, `CI.md`, `STRUCTURE.md`) |
| Cold-start for any Drive agent | Nest `HANDOFF.md` only (point into tracks) |
| Vision / architecture / workflows / platform | `plans/cline-drivemode/foundation/` |
| Research, inventory, audit, “future of X” | `plans/cline-drivemode/research/` |
| SE/PM brief, systems analysis, entry gates | `plans/cline-drivemode/leadership/` |
| Task graph, agent runbook, active track handoff | `plans/cline-drivemode/delivery/` |
| Decision (DEC) | `plans/cline-drivemode/decisions/` |
| Architecture decision (ARD) | `plans/cline-drivemode/ard/` |
| Product requirements | `plans/cline-drivemode/prd/` |
| Single feature spec | `plans/cline-drivemode/features/DRV-*.md` |
| Multi-slice delivery plan (README + phases/slices) | `plans/cline-drivemode/initiatives/<slug>/` |
| Schema freeze / index | `plans/cline-drivemode/schemas/` |
| Example agent home / fixture | `plans/cline-drivemode/examples/` |
| Ops runbook or smoke checklist | `plans/cline-drivemode/ops/` |
| Closed PR/session handoff | `plans/cline-drivemode/archive/` |
| Host port / harness / leverage / conformance | `plans/drivecode-sdk/` |
| Brand tokens | `design/brand/` |
| HTML IA prototype / DEMO runbook | `design/wireframes/` |
| Overview / share canvases | `design/canvases/` |
| Product screenshot | `assets/{hub,tui,demos,logos}/` |
| Term definition | `meta/glossary.md` |
| PR review narrative | `meta/reviews/` |

## Initiative convention

```text
plans/cline-drivemode/initiatives/<slug>/
├── README.md          # purpose, linked DRV ids, status (active|reference|done)
├── overview.md        # optional narrative
├── slice-N-*.md       # or phase-N-*.md
└── testing.md         # optional
```

Create an initiative when a feature needs more than one implementation doc.
Keep the DRV one-pager as the product contract; the initiative is the delivery
breakdown.

## Current → target map (high level)

| Current | Target |
|---|---|
| Nest root reference `*.md` | Stay at root **or** `reference/` |
| `00–01`, `05–08` in cline-drivemode | `foundation/` |
| `02–04`, `12–14` | `research/` |
| `LEADERSHIP-*`, `SYSTEMS-*`, `CHECKLIST-*`, `MATRIX-*` | `leadership/` |
| `TASK-GRAPH`, `AGENT-RUNBOOK`, active `HANDOFF.md` | `delivery/` |
| `HANDOFF-pr*.md`, stale session notes | `archive/` |
| `09–11`, `MVP-UI-*` topic stubs | Fold into matching `initiatives/` or demote to links from initiative README |
| `show-backlog-director/`, `task-bank-*`, `share-*` | `initiatives/<same-slug>/` |
| `local-stt.md`, `smoke-voice-*.md`, `ops/` | `ops/` |
| `design/drive-wireframes/*` | Split into `design/{brand,wireframes,canvases}/` |
| Flat `assets/*` | `assets/{logos,hub,tui,demos}/` |
| `reviews/glossary.md` | `meta/glossary.md` |
| `reviews/PR-*.md` | `meta/reviews/` |
| `plans/drivecode-sdk/00–08` | Keep flat **or** split `foundation/` + `delivery/` |

## Migration constraints

- Grep and fix absolute `docs/drivecode/...` and relative cross-folder links; do not leave stubs at old paths.
- Update `AGENTS.md` layout table and nest `README.md` indexes in the same change as moves.
- Prefer one atomic move PR per layer (plans internals → design/assets → meta) over a single mega-diff if reviewability matters.
- Do not recreate parallel trees outside this nest (`docs/plans/`, `docs/design/`, etc.).

## Success criteria

- A new agent can answer “where does this file go?” from the placement matrix alone.
- Nest root stays ≤ ~8 process/reference entry files.
- Product plan top level is only: README + role folders (`foundation`, `research`, …), not a mixed bag of markdown and initiative dirs.
- Screenshots are findable by surface (`hub` / `tui` / `demos`) without reading filenames.
- Glossary and reviews are not peers of product plans.

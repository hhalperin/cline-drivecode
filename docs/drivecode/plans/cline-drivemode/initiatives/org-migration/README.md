# org-migration · `hhalperin/cline-drivecode` → `drive-mode/cline-drivecode`

**Status:** plan (opened 2026-08-08)
**Goal:** make `drive-mode/cline-drivecode` the canonical home of the product, so
the web app and the mobile app can be tested against a hostname and a release
we own — instead of a personal fork.
**Answers:** [hosted-preview](../hosted-preview/README.md) open question 2
("Where does the repo move land?") and the `drive-mode/site` README line that
already promises Cline Drive is "moving to `drive-mode` shortly".
**Constrained by:** [ADR-0016](../../adr/ADR-0016-distribution-and-positioning.md)
(public self-hosted beta), [ADR-0021](../../adr/ADR-0021-drive-credential-onboarding.md)
(credentials), [DEC-package-location](../../decisions/DEC-package-location.md).

Companion pages:

| Page | What it holds |
|---|---|
| [inventory.md](inventory.md) | What exists today, measured — repos, divergence, CI, the reference count |
| [cutover.md](cutover.md) | The runbook. Exact commands, ordered, with the rollback for each |
| [testing.md](testing.md) | The web-app and mobile-app test paths this migration exists to unblock |

## The finding that shapes the plan

**The content move is already trivial. The identity move is not.**

`drive-mode/cline-drivecode` is a **fork** of the personal repo, created
2026-07-30, and its `main` is a **strict ancestor** of the personal `main`:

```
git merge-base --is-ancestor org/main origin/main   → true
git rev-list --count org/main..origin/main          → 81
git rev-list --count origin/main..org/main          → 0
```

Eighty-one commits behind, **zero divergence**. There is no merge, no conflict,
no history rewrite — the content sync is a fast-forward push. Anyone expecting
this migration to be a git problem is solving the wrong half.

The real work is that four things still name the personal repo as the product's
home, and every one of them is on the path a tester walks:

1. **`drive-beta-release.yml` is hard-guarded to `hhalperin/cline-drivecode`.**
   Both jobs carry `if: github.repository == 'hhalperin/cline-drivecode'`. In the
   org it does not fail — it *skips*, silently and green. The org repo cannot cut
   a beta tag today and would not tell you why.
2. **The release notes the workflow generates hand testers the wrong clone URL**
   and three `hhalperin/...` doc links they will click.
3. **45 references across 24 files** point at the personal repo, including
   `README.md`, `AGENTS.md`, [install.md](../../../../reference/install.md), and
   [MVP-beta.md](../../delivery/MVP-beta.md).
4. **The fork relationship itself leaks**, in ways that matter for a public
   product front door — see below.

## The fork question — decide this first

Everything else is mechanical. This is not, and it is cheapest to settle before
the org repo has traffic, issues, or stars to lose.

`drive-mode/cline-drivecode` being a *fork* rather than a *repository* costs us
four concrete things:

| Cost | Evidence |
|---|---|
| **Invisible to GitHub search.** Forks are excluded by default. | `org:drive-mode` returns 5 repos and **not** `cline-drivecode`. Only `fork:true` surfaces it. Someone searching for the product does not find it. |
| **PRs default their base to the parent.** | A Drive PR opened from a branch defaults to `hhalperin/cline-drivecode:main`. One missed dropdown puts our work in the personal repo — or further up the chain. |
| **Upstream's scheduled publish workflows run here.** | 23 scheduled runs in 5 days on a repo nobody is working in: `cli-publish`, `sdk-publish`, the combined nightly, `repo-stale-issues` — including one `sdk-publish` **failure** on 2026-08-04. |
| **Detaching later needs GitHub Support.** | Fork relationships are not self-serve. The cost only grows once issues and stars exist. |

Three ways out. All are reversible except the third's fork badge.

| Option | What it costs | What it buys |
|---|---|---|
| **A. Keep the fork** | Every cost above, permanently | Nothing to do |
| **B. Ask GitHub Support to detach** | A support ticket and a wait of unknown length | Keeps the repo, its URL, its one closed PR, its Actions history |
| **C. Delete and re-push as a fresh repo** | Loses the fork badge, the single closed PR #1, and 28 runs of Actions history | Immediate, self-serve, and the result is a real repository |

**Recommendation: C, and do it before the sync.** The org repo currently holds
exactly one closed PR and five days of scheduled-cron noise — that is the entire
inventory we would be discarding, and it is the cheapest this decision will ever
be. B is the right call *only* if the closed PR or the Actions history is worth
waiting on a support ticket for; nothing in [inventory.md](inventory.md) suggests
it is.

Doing it in the other order — sync first, then re-create — means pushing 149 MB
of history twice.

> **Owner decision required.** [cutover.md](cutover.md) phase 1 is written for
> **C**, with the **B** and **A** variants noted inline. Nothing downstream of
> phase 1 changes based on the answer.

## What moves, what stays, what is already home

The org is not one repo, and "move everything" is the wrong instinct — two of
these are already where they belong and one should probably not move at all.

| Repo | Today | Disposition |
|---|---|---|
| `cline-drivecode` | Personal, canonical; org fork 81 behind | **Move.** This plan |
| [`drive-mode/site`](https://github.com/drive-mode/site) | Org, live at `drivemode.ai` | **Home already.** Owns the `cline.drivemode.ai` hostname, DNS, and `_headers` — the web test path runs through it |
| [`drive-mode/drivemode-mcp`](https://github.com/drive-mode/drivemode-mcp) | Org, v0 | **Home already.** See the duplication question below |
| [`drive-mode/collaboration-harness`](https://github.com/drive-mode/collaboration-harness) | Org, v0 | **Home already.** Same |
| `drive-mode/cursor-drive`, `drive-mode/claude-drive` | Org | **Untouched.** Sibling products |
| `hhalperin/drivekanban` | Personal fork of `cline/kanban`, publishes as `kanban` | **Do not move yet.** It is the agent execution backlog *tool*, not the product, and it publishes to npm under a name we do not own. Moving it is a separate decision with a registry question attached |

### The duplication this migration should name, not inherit

Two implementations of the same five primitives — presence, spotlight,
narration, interrupt, address — will sit in one org after the move:

| | `@cline/drive` | `@drive-mode/collaboration-harness` |
|---|---|---|
| Lives in | `sdk/packages/drive/` (this repo) | Its own org repo |
| Maturity | Shipped; hub-backed; the product | v0; `createMemoryHost`; no hub bridge |
| Both have | `reduceRoom`, a host port, appearance-only profiles, privacy-strict schemas | ← |

[DEC-package-location](../../decisions/DEC-package-location.md) closed phase 1
with "`@cline/drive` in this monorepo; **extract only when a second host needs
the package**." `collaboration-harness` plus `drivemode-mcp` **is** that second
host, and it was built as a parallel implementation rather than an extraction.

That is not a migration blocker and this plan does not resolve it — but shipping
both under one org without naming it is how the demo canvas and the app drifted
to 370 px versus 9 px. Phase 6 opens the ADR; it does not pre-judge the answer.

## Phases

Gates, not dates. Phases 1–3 are the migration; 4–5 are what it unblocks; 6 is
the debt it surfaces.

| # | Phase | Ships | Gate |
|---|---|---|---|
| 0 | **Fork decision** | The owner picks A, B, or C above | Recorded as a DEC; `cutover.md` phase 1 has one path |
| 1 | **Repo identity** | Fork resolved; `main` fast-forwarded to 81 commits ahead | `drive-mode/cline-drivecode@main` == personal `main`; repo answers to a plain `org:drive-mode` search |
| 2 | **CI that tells the truth** | Inherited upstream crons disabled; `drive-beta-release` retargeted; CODEOWNERS + labels seeded | `drive-ci` green on the org; a dispatched `drive-beta-release` **runs** instead of skipping; zero scheduled runs in 48 h |
| 3 | **Identity in the docs** | 45 refs retargeted; `site` README de-promised | The [cutover gate command](cutover.md#verify-the-gate) prints nothing — every remaining ref is in a keep-as-written path; a tester following `install.md` clones the org |
| 4 | **Web app testable** | `cline.drivemode.ai` live from `drive-mode/site`; artifact handshake | [testing.md](testing.md) W-gates: TLS valid, `microphone=(self)` verified, demo plays on a phone |
| 5 | **Mobile app testable** | PWA install path on the new hostname; iOS route documented honestly | [testing.md](testing.md) M-gates: standalone window runs the call shell; MC3 mic policy verified |
| 6 | **Harness duplication ADR** | An ADR that either extracts, bridges, or deliberately forks the two kernels | ADR proposed against [DEC-package-location](../../decisions/DEC-package-location.md); no code change required to open it |

Phase 2 is deliberately ahead of phase 3. A green CI signal that is green
because every job skipped is worse than a red one, and phases 4–5 are about to
start trusting it.

## What this plan does *not* do

- **It does not move the product forward.** The web app is blocked by
  [drive-web](../drive-web/README.md) phase 1 (the 9 px stage), not by the org.
  The mobile app is blocked by MC1's remaining call verbs. Migrating changes
  neither. See [testing.md](testing.md) for what actually gates each.
- **It does not open a hosted hub.** Tiers 1–3 stay credential-free
  ([hosted-preview](../hosted-preview/README.md)); path H stays
  [ADR-0029](../../adr/ADR-0029-room-hotpath-redesign.md) H5's problem.
- **It does not rename packages.** `@cline/*` scopes, the `cline/cline-bench`
  submodule, and the upstream merge path are untouched. Renaming the scope is a
  registry decision, not an org decision, and nothing in the test paths needs it.
- **It does not archive the personal repo.** Until phase 3's gate holds, the
  personal repo is still the one the docs point at. Archiving before that
  strands every published link.

## Open questions for the owner

1. **Fork: A, B, or C?** Phase 0. Everything else is written to be
   indifferent to the answer.
2. **Does the personal repo stay as a mirror, or become a redirect?** GitHub
   renames leave redirects; deleting does not. Recommendation: leave it in place,
   unarchived and untouched, until phase 4's gate holds — then archive with a
   README pointer rather than deleting.
3. **Who is the org's CODEOWNER?** The inherited `.github/CODEOWNERS` names four
   Cline maintainers who have no relationship to this fork. It should name the
   Drive owners or be deleted; leaving it means review requests fire at people
   who did not sign up.

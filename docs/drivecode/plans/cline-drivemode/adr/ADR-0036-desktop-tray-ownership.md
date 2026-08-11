# ADR-0036 · Desktop tray ownership (Cline vs Kanban)

**Status:** Open (2026-08-11)  
**Owner:** Drivecode SE lead  
**Constrained by:** [ADR-0026](ADR-0026-evidence-backed-done.md),
[ADR-0033](ADR-0033-managed-execution-boundary.md).

## Context

The Tauri desktop shell at `apps/examples/desktop-app` now hosts two
subsystems that both want to say how much work is in flight.

**Cline owns the tray today.** `setup_tray_icon` (`src-tauri/src/main.rs:791`)
builds a menu whose second item is a status line — `"0 sessions running"` — and
`set_tray_status` (`main.rs:848`) is the command that writes it. The renderer
drives it from `webview/lib/desktop-tray.ts`, polling every five seconds.
`tray_status_text` (`main.rs:117`) already resolves one conflict inside that
slot: update progress outranks hub health.

**Kanban produces the same shape of information about a different subsystem.**
`formatPresenceSummary` (`desktop-bridge/src/presence/presence-controller.ts:55`)
renders strings like `"2 running, 1 ready for review"`, and the adapter declares
`CMD_SET_TRAY_SUMMARY` (`desktop-tauri/src/commands.ts:44`) to publish it.

Nothing connects them, deliberately. `kanban.rs`'s `CAPABILITIES`
(`src-tauri/src/kanban.rs:52`) omits `tray`, so `hasTray` in the adapter is
always false and `presence-view.ts` short-circuits before it would ever call
`kanban_set_tray_summary` — which the host does not register anyway. Kanban's
presence drives the dock badge and the user-attention signal instead, both of
which are per-window and conflict with nothing.

The reason for the omission is that both writers want **one slot**. Letting
each write it makes the tray show whichever wrote last, which is not a merge
but a race, and a race whose output is a number the user is meant to trust.

This was found while chasing a dead-code warning in #234 and has been recorded
three times since — `kanban.rs:22-29`, `apps/kanban/AGENTS.md:100`, and the
#234 PR body. It is written down in the source but has never been a decision,
which is what this record fixes.

## Decision

**Deferred.** No option below is Accepted yet. What is decided is the
constraint that holds until one is:

1. **`tray` stays unadvertised in `kanban.rs`'s `CAPABILITIES`.** The declared
   capability rule (host command first, capability second — `kanban.rs:32-34`)
   means adding it before a merged tray exists would turn a documented no-op
   into a call that fails.
2. **Neither subsystem writes the other's slot.** Kanban's presence is confined
   to the dock badge and attention signal.
3. Nothing is blocked by this. Both subsystems ship their status through
   surfaces that do not collide, so the cost of deferring is that Kanban's
   summary is absent from the tray, not that anything is wrong in it.

### Options, for whoever picks this up

| Option | What the tray says | Cost |
|---|---|---|
| **A. Two lines** | Cline keeps `"N sessions running"`; Kanban gets its own adjacent item, e.g. `"Kanban: 2 running, 1 ready for review"` | A second row; two independent writers, no shared state |
| **B. One combined line** | A single summary spanning both, written by one owner both sides feed | Needs a combined state owner; changes what `set_tray_status` means, and `tray_status_text`'s existing precedence rule has to absorb a third input |
| **C. Status quo** | Cline only | Kanban's summary never reaches the tray |

Option A is the smaller change and preserves each subsystem's existing writer.
Option B is the better tray if the two counts are genuinely one number to a
user, which is a product question about whether a Kanban card in review and a
Cline session running are the same kind of thing — and under
[ADR-0033](ADR-0033-managed-execution-boundary.md) they are not: DrivePlan owns
task truth and Kanban is the execution workbench.

## Consequences

- The tray remains a Cline surface. Anyone adding a Kanban tray item must land
  the host command before the capability, and must resolve this record first.
- `CMD_SET_TRAY_SUMMARY` and `formatPresenceSummary` stay in the tree as
  unreachable-but-tested code. That is intentional: the string a merged tray
  would show already exists, so whichever option is chosen is a wiring change
  rather than a new feature.
- Reopening this needs a product answer, not an implementation one. The
  question is what a combined count *means*, and the implementation follows.

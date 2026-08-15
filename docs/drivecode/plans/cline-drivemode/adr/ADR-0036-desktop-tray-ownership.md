# ADR-0036 · Desktop tray ownership (Cline vs Kanban)

**Status:** Accepted (2026-08-15) — Impl partial: step 1 (a presence producer)
landed; steps 2–3 (the host command, then the capability) remain  
**Owner:** Drivecode SE lead  
**Constrained by:** [ADR-0026](ADR-0026-evidence-backed-done.md),
[ADR-0033](ADR-0033-managed-execution-boundary.md).

## Context

The Tauri desktop shell at `apps/examples/desktop-app` hosts two subsystems that
both want to say how much work is in flight.

**Cline owns the tray today, across two status items — not one.**

```rust
struct TrayMenuState {
    status: MenuItem<tauri::Wry>,           // "Status: Healthy"
    hub_healthy: Mutex<bool>,
    running_sessions: MenuItem<tauri::Wry>, // "0 sessions running"
}
```

`setup_tray_icon` (`src-tauri/src/main.rs:843`) builds both and
`set_tray_status` (`main.rs:901`) writes both in one call, under two different
policies: `status` goes through `tray_status_text` (`main.rs:135`), which ranks
update progress above hub health, while `running_sessions` takes a raw count.
The renderer drives it from `webview/lib/desktop-tray.ts`, polling every five
seconds.

**Kanban produces the same shape of information about a different subsystem.**
`formatPresenceSummary`
(`desktop-bridge/src/presence/presence-controller.ts:55`) renders strings like
`"2 running, 1 ready for review"`, and the adapter declares
`CMD_SET_TRAY_SUMMARY` (`desktop-tauri/src/commands.ts:44`) to publish it.

Nothing connects them. `kanban.rs`'s `CAPABILITIES`
(`src-tauri/src/kanban.rs:58`) omits `tray`, so `hasTray`
(`desktop-tauri/src/tauri-host.ts:128`) is always false and `presence-view.ts`
short-circuits before it would ever call `kanban_set_tray_summary` — which the
host does not register anyway.

### The scarce resource is not a menu row

This was first recorded as "both writers want one slot." That framing does not
survive contact with the code above. The menu is a `MenuBuilder` chain and
`TrayMenuState` is a struct of items, so a third row costs one field and one
`.item()` call — and the tray already runs two independent write policies side
by side. Nothing is scarce.

What is actually contended is **who owns merge policy**: whether Kanban's count
is presented by Kanban's own writer, or folded into a summary that some single
owner computes.

That distinction matters because the two halves differ sharply in
reversibility:

| Change | Reversible? |
|---|---|
| A third menu row, and what it says | Yes — host-local, one struct field, unit-testable |
| Which row Kanban's string lands in | Yes — same |
| `tray` in `kanban.rs`'s `CAPABILITIES` | **No.** The declared-capability rule (`kanban.rs:38-40`) means advertising it flips `hasTray` true and `presence-view.ts` starts calling. Withdrawing it later is a breaking change to the bridge contract. |

Every option below needs the *same* contract change and differs only in what
the host does once the string arrives. So the deliberation this record carried
belonged to the contract; the presentation question is not ADR-grade.

### Presence had no producer, which is what sequenced this

Earlier revisions of this record said Kanban's presence "drives the dock badge
and the user-attention signal instead, both of which are per-window and conflict
with nothing." That was **false** when written, and correcting it is what set
the order of the three steps below.

`PresenceController.update` (`presence-controller.ts:88`) is the sole path to
all three signals — badge, attention, and summary — and it is reached only from
`presence.setCounts` (`desktop-api.ts:246`). For the whole life of this record
`setCounts` had **no production caller**: it appeared in `contract.ts`, its own
implementation, and one test. #238 mounted the bridge, so `window.desktop`
existed and `useDesktop()` was exported, but no component called it. The
namespace was not "the tray half is blocked and the rest works" — it was
entirely dead, and advertising `tray` would have opened a one-way door onto a
path with no data behind it.

**Step 1 has since landed.** `useDesktopPresence`
(`web-ui/src/desktop/use-desktop-presence.ts`), called from `App`, derives the
counts from task-session state — `running` and `awaiting_review`, which are
what the contract's two fields mean — and pushes them on every change. Because
`presence` is already in `CAPABILITIES`, that immediately lights the dock
badge, the attention signal and the wake lock. Only the tray summary still
short-circuits, on `hasTray`.

The counts come from session state rather than board columns deliberately:
`running` is what the host turns into an OS wake lock, so it has to mean "an
agent is executing", not "a card sits in the in_progress column" — the latter
would keep the machine awake over a card left there on Friday.

This was found while chasing a dead-code warning in #234 and has been recorded
three times since — `kanban.rs:22-35`, `apps/kanban/AGENTS.md:106`, and the
#234 PR body.

## Decision

**Accepted.** Three parts, in the order they bind.

### 1. Kanban publishes a summary; the host places it

The capability `tray` promises exactly one thing: *here is my presence
summary*. Placement, precedence and merge policy stay on the host's side of the
boundary — the same side `tray_status_text` already arbitrates on. Kanban never
owns a tray item.

This is the one-way half, and it is chosen because it keeps every presentation
option reachable without a second contract change. It also puts multi-window
merge where it can actually be done: each project window mounts its own bridge
and its own `PresenceController`, so N windows will publish N summaries into
one tray. Only the host can see all of them. A contract that let Kanban own an
item would move that merge to the side that cannot perform it, and reproduce
last-writer-wins *within* Kanban.

### 2. Presentation is Option A — a distinct Kanban item

Cline keeps `"N sessions running"`. Kanban gets its own adjacent item.

Chosen over a combined line because **A is the only option whose correctness
does not depend on [ADR-0033](ADR-0033-managed-execution-boundary.md) being
ratified.** 0033 (Proposed) holds that DrivePlan owns task truth and DriveKanban
is the execution workbench, which may "**display** gate state" but not "**decide**
bank complete." A single merged number asserts one truth across that boundary
and is only safe if 0033 resolves a particular way; two items assert nothing
about the relationship and are correct either way.

A is also reversible, and leaves B reachable under part 1 without a further
contract change. Whether two counts read as one thing to a user is a question
no argument settles; A costs nothing to undo and produces the usage that would
settle it.

### 3. `tray` is advertised when a producer exists, not before

Sequencing, per the declared-capability rule: host command first, capability
second. Concretely, in order:

1. ~~Something calls `presence.setCounts`.~~ **Done** — `useDesktopPresence`,
   mounted in `App`. The badge, attention signal and wake lock are live.
2. The host registers `kanban_set_tray_summary` and keys stored summaries by
   window label, per part 1. **Remaining.**
3. `"tray"` joins `CAPABILITIES` — a one-line change, and the point of no
   return. **Remaining.**

Landing 2 before 1 would have put a permanently blank row in a shipping tray,
which is user-visible harm in exchange for nothing. With 1 done that risk is
gone, and 2–3 are now unblocked wiring.

## Consequences

- **What is settled:** the contract's shape and the presentation. Neither needs
  revisiting, and neither is blocked on ADR-0033. Anyone implementing this
  follows the three steps above rather than reopening the question.
- **What is not:** whether a combined line is better than two. Part 2 keeps it
  reachable; deciding it needs usage that does not exist yet.
- **The named blocker is cleared.** It was "a product answer about what a
  merged tray says", then "`presence.setCounts` has no caller". Both are
  resolved: the decision is Accepted above and the producer has landed. What
  remains is steps 2–3, which are wiring against a settled contract.
- `CMD_SET_TRAY_SUMMARY` and `formatPresenceSummary` stay in the tree as
  unreachable-but-tested code. That is intentional and now explicitly
  sequenced: the string a merged tray would show already exists, so step 2 is
  wiring rather than a new feature.
- The tray remains a Cline surface until step 3 lands.

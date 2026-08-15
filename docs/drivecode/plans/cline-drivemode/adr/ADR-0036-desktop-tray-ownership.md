# ADR-0036 · Desktop tray ownership (Cline vs Kanban)

**Status:** Open (2026-08-11)  
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

Nothing connects them, deliberately. `kanban.rs`'s `CAPABILITIES`
(`src-tauri/src/kanban.rs:56`) omits `tray`, so `hasTray` in the adapter is
always false and `presence-view.ts` short-circuits before it would ever call
`kanban_set_tray_summary` — which the host does not register anyway. Kanban's
presence drives the dock badge and the user-attention signal instead, both of
which are per-window and conflict with nothing.

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
| `tray` in `kanban.rs`'s `CAPABILITIES` | **No.** The declared-capability rule (`kanban.rs:36-38`) means advertising it flips `hasTray` true and `presence-view.ts` starts calling. Withdrawing it later is a breaking change to the bridge contract. |

Every option below needs the *same* contract change and differs only in what
the host does once the string arrives. So the deliberation this record has been
carrying belongs to the contract; the presentation question is not ADR-grade,
and treating it as though it were is why the record has stayed open.

This was found while chasing a dead-code warning in #234 and has been recorded
three times since — `kanban.rs:22-33`, `apps/kanban/AGENTS.md:106`, and the
#234 PR body. It is written down in the source but has never been a decision,
which is what this record fixes.

## Decision

**Deferred.** No option below is Accepted yet. What is decided is the constraint
that holds until one is, and which question has to be answered to lift it.

1. **`tray` stays unadvertised in `kanban.rs`'s `CAPABILITIES`.** The declared
   capability rule (host command first, capability second — `kanban.rs:36-38`)
   means adding it before a merged tray exists would turn a documented no-op
   into a call that fails.
2. **Neither subsystem writes the other's item.** Kanban's presence is confined
   to the dock badge and attention signal.
3. Nothing is blocked by this. Both subsystems ship their status through
   surfaces that do not collide, so the cost of deferring is that Kanban's
   summary is absent from the tray, not that anything is wrong in it.

### The question to answer

Not "one row or two" — that is host-local and reversible. The one-way decision
is **the shape of the capability contract**:

> Does Kanban publish *a summary the host places*, or does it publish *into a
> named tray item that Kanban owns*?

Scoped the first way, `tray` promises only "here is my presence summary," and
placement, precedence and merge policy stay on the host's side of the boundary
— the same side `tray_status_text` already arbitrates on. Options A/B/C below
then collapse into a host-side presentation choice, changeable in an afternoon,
with the contract decided once. Scoped the second way, Kanban owns an item and
A is the only reachable option for as long as the contract stands.

### What that turns on

Whether a combined count is meaningful is a boundary question, and
[ADR-0033](ADR-0033-managed-execution-boundary.md) already answers it: DrivePlan
owns task truth, DriveKanban is the **execution workbench**, and Kanban "may
**display** gate state; it may not **decide** bank complete." A single merged
number is the tray asserting one truth across the boundary 0033 exists to keep
separate.

**ADR-0033 is `Proposed`, not `Accepted`.** That, and not a fresh product
debate, is what actually blocks this record. Ratifying 0033 settles the
semantics by inference and leaves only the contract shape above to fix.

### Options, for whoever picks this up

| Option | What the tray says | Cost |
|---|---|---|
| **A. Two items** | Cline keeps `"N sessions running"`; Kanban gets its own adjacent item, e.g. `"Kanban: 2 running, 1 ready for review"` | One struct field and an `.item()` call. Two independent writers, no shared state — which is what the tray already does. |
| **B. One combined line** | A single summary spanning both, written by one owner both sides feed | Needs a combined state owner; changes what `set_tray_status` means to its existing five-second poller, and `tray_status_text`'s precedence rule has to absorb a third input. Constrained against by ADR-0033. |
| **C. Status quo** | Cline only | Kanban's summary never reaches the tray |

Under the host-places-it contract, **A is the reversible default and B stays
reachable without a second contract change** — which is the order the evidence
favours. Whether two counts read as one thing to a user is a question no
argument settles; A costs nothing to undo and produces the usage that would
settle it.

## Consequences

- The tray remains a Cline surface. Anyone adding a Kanban tray item must land
  the host command before the capability, and must resolve this record first.
- `CMD_SET_TRAY_SUMMARY` and `formatPresenceSummary` stay in the tree as
  unreachable-but-tested code. That is intentional: the string a merged tray
  would show already exists, so whichever option is chosen is a wiring change
  rather than a new feature.
- Lifting this needs [ADR-0033](ADR-0033-managed-execution-boundary.md)
  ratified, then one contract decision. It does **not** need a fresh product
  debate about menu rows: that half is reversible, host-local, and does not
  belong in an ADR.

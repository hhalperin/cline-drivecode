# 15 · Strategy brainstorm: a decoupled Drive Mode MCP

Status: **brainstorm / futures**. Not binding. Does not overturn D2 (hub single writer, no default `:7891`) or the `drivecode-sdk` “no transport in the kernel” rule. Those stay binding for *cline-drivecode* until an explicit DEC/ARD revisits them.

Back to [plan index](../README.md). Related: [00-vision](../foundation/00-vision.md), [01-architecture](../foundation/01-architecture.md) D2, [drivecode-sdk 01-scope](../../drivecode-sdk/foundation/01-problem-and-scope.md), [00-omnigent](../../drivecode-sdk/foundation/00-discovery-omnigent.md), [04-future-multi-user](04-future-multi-user.md).

---

## One sentence

**What if the portable product is not “Drive inside Cline,” but a small MCP that any agent host can call to publish live reactions onto a shared visual stage — so the *feeling* of drive-coding (presence, spotlight, interrupt, narration) becomes a reusable layer for any multi-agent use case?**

---

## Why this idea keeps coming back

Three prior arts already proved the *agent-facing* half of Drive as MCP tools:

| Prior art | Role of MCP |
|---|---|
| `cursor-drive` (`:7891`) | Agent publishes stage cards, decisions, mode, presence through MCP tools while Cursor runs the loop |
| `claude-drive` | Same tool vocabulary over the Claude Agent SDK |
| `cline-drivecode` | Collapsed that surface into **hub ops** so Cline stays the single writer |

The current product correctly rejected **porting the daemon wholesale** into this monorepo (second writer, second port, syncTypes drift). That rejection answers a *packaging* question, not a *product category* question.

The category question is still open:

> Is “live reacting agents with visuals” a Cline mode, or a transport-agnostic collaboration protocol that Cline happens to host first?

This brainstorm explores the second answer without abandoning the first.

---

## What “the feeling” actually is

Strip Drive of IDE chrome and coding-specific cards. The load-bearing sensation is five primitives:

| Primitive | Felt as | Protocol-ish form |
|---|---|---|
| **Presence** | Someone is *in the room* with you | roster + join/leave + speaking/working flags |
| **Spotlight** | You can *see* what they are doing now | stage pointer + last-work-event-wins projection |
| **Narration** | They explain *why*, not keystrokes | conversation-track events with density policy |
| **Interrupt** | You can stop them without fighting | raise-hand → gate → resume |
| **Address** | You talk to one, many, or a pack | address set before send |

Everything else (Discord IA, Slack chrome, voice, WebRTC, RosterPack, AgentProfile ink) is productization of those five.

**Implication.** If those five are the product, the right package boundary is a *stage + room protocol*, not a Cline feature flag. Coding-agent work cards are one **renderer pack**. Ops, research, teaching, support, creative review can each ship their own card schemas on the same room kernel.

---

## The MCP wedge (reframe, not resurrection)

### What MCP is good for here

MCP is the natural **agent → stage** write API:

- Any MCP-capable host (Cursor, Claude Code, Codex, custom runners, Omnigent-style meta harnesses) can call tools without embedding a Drive SDK.
- Tools map cleanly onto work-track publishers: `stage.publish_edit`, `stage.publish_decision`, `stage.set_mode`, `stage.raise_hand_ack`, `roster.announce`, …
- Resources / subscriptions (where supported) map onto room snapshot + event cursor — the same `seq` idea Status Hub already uses.

### What MCP must not become (again)

| Anti-pattern | Why it failed before |
|---|---|
| Default second writer daemon on a magic port | Two truths for one room; hub vs MCP race |
| MCP owns agent prompts / tools / model ids | Forks the host’s agent registry (`AgentProfile` lesson) |
| MCP owns pixels | Privacy + cost; events-first remains the honest agent stage |
| MCP *is* the product UI | Surfaces project; they never own room truth |

So the strategy is **MCP as a client contract**, not **MCP as the room runtime**.

```text
  Agent host(s)  --MCP tools-->  Stage writer  --events-->  Viewer(s)
       ^                            |                         |
       |                     single writer                    |
       +-------- optional host port / SDK <-------------------+
```

Cline hub can be *one* writer implementation. A standalone `drive-stage` process can be another. The MCP schema stays the same.

---

## Four strategic shapes

### Shape A — MCP façade on the Cline hub (lowest risk)

Ship an optional MCP server that **only** forwards to existing `drive.*` hub ops. Cline remains the single writer. Agents outside the hub (e.g. a Cursor session pointed at the same room) can publish work events.

- **Wins:** honors D2; reuses `@cline/drive` reducers; proves multi-host *publish* without a second product.
- **Loses:** still Cline-coupled for the room; “any use case” viewers stay hub webview / TUI.
- **Verdict:** good **internal** bridge, weak as a category bet.

### Shape B — Standalone Drive Stage product (category bet)

A small, Cline-decoupled package:

1. **Writer daemon** (or embedded library) owning room + event log + MCP tool surface.
2. **Viewer** (web or electron-light) that only folds `DriveEvent` → Spotlight / roster / feed.
3. **Schema packs** for domains (coding, ops, research, …) registering work-event types + card components.

Cline becomes a **first-party host adapter**: its hub either *is* the writer or *bridges* to it. Other hosts only need MCP.

- **Wins:** matches Omnigent’s “composition / control / collaboration above the harness”; unlocks non-coding rooms; kills syncTypes by publishing one protocol.
- **Loses:** reopens the second-process question; needs a DEC that D2 applies to *Cline’s default*, not to the universe; brand/product split risk (“Drive” vs “Cline Drive”).
- **Verdict:** the real strategy if the north star is *feeling*, not *Cline feature share*.

### Shape C — Protocol-first, implementations later (library bet)

Publish only:

- versioned `DriveEvent` / room schemas (`@drive/protocol` or extracted from `@cline/shared`)
- pure `reduceRoom` / policies (`drivecode-sdk` role, already planned)
- MCP tool/resource **spec** (OpenAPI-ish JSON schema), no mandatory daemon

Hosts embed the writer. MCP is optional. Conformance kit (already in drivecode-sdk plan) becomes the product.

- **Wins:** aligns with existing harness plan; no second daemon forced; extraction path already named in DEC-package-location.
- **Loses:** no out-of-box “feeling” for a random Claude session until someone embeds the writer; slower category signal.
- **Verdict:** correct **engineering** path; under-sells the demo unless paired with a reference viewer + MCP server as *examples*, not the kernel.

### Shape D — Hybrid “reference stage” (recommended exploration)

Do **C + thin B as reference**, keep **A for Cline**:

| Layer | Owner | Couples to Cline? |
|---|---|---|
| Event schemas + reducers + policies | `drivecode-sdk` / `@cline/drive` | No (already the rule) |
| MCP tool/resource **spec** | Same package or `drive-mcp` schema package | No |
| Reference writer + viewer | New small app / example (may live outside monorepo later) | No |
| Cline hub binding | `@cline/core` hub | Yes — production writer for Cline users |
| Optional MCP façade | Speaks hub or reference writer | Thin |

D2 stays true for Cline defaults. The *category* artifact is the protocol + reference MCP + viewer. “Decoupled Drive Mode MCP” is the **agent I/O**, not a fork of room truth.

---

## “Any use case” — what must generalize

Coding Drive today assumes work events like edit / command / test / plan / decision. For arbitrary domains, keep the **tracks** and swap the **payload catalog**:

| Track (stable) | Coding pack | Example other packs |
|---|---|---|
| `control` | mode, address, gates | same |
| `presence` | join, typing, speaking | same |
| `conversation` | chat, narration, captions | same |
| `work` | edit, test, plan, decision | `ops.alert`, `research.source`, `support.ticket`, `teach.whiteboard`, `creative.crit` |
| `media` | later | later |

**Renderer packs** register: event Zod schemas, Spotlight card components, optional Show/director producers. The room kernel never learns “ticket” vs “diff”.

That is how you get live-reacting agents for *any* use case without a second product architecture per vertical.

---

## What the MCP tool surface might look like (sketch)

Not a spec — a vocabulary check against the five primitives:

```text
room.join / room.leave / room.snapshot
roster.list / roster.set_profile_overlay
address.set
stage.publish_work          # typed; schema from active pack
stage.set_sharer
stage.present_show          # optional director/show
mode.set / mode.get
interrupt.raise / interrupt.ack
narrate                     # or fold into conversation.publish
events.subscribe(sinceSeq)  # resource or notifications
```

Hard rules for the sketch:

1. Tools publish **events**; they do not mutate opaque UI blobs.
2. No tool accepts raw prompt bodies or model ids (host owns the agent).
3. Work payloads are validated against a declared pack id + schema version.
4. Privacy defaults: no transcript persistence unless a visible facet says so.

---

## Tension with binding decisions (name it honestly)

| Binding today | How this brainstorm relates |
|---|---|
| D2: no second daemon / no default `:7891` in *this* product | Shape D keeps Cline on one writer; reference MCP is opt-in / separate artifact |
| Kernel has no transport | MCP server is an **adapter app**, never inside `@cline/drive` |
| `AgentProfile` ≠ agent definition | MCP must not grow a second agent YAML |
| Events-first stage | MCP publishes structured work facts, not pixels |
| Extract `@cline/drive` only when a second host needs it | A real non-Cline MCP consumer *is* the extraction trigger |

If leadership wants Shape B as the company bet, it needs an explicit DEC: **“Drive Stage is a product; Cline is a host.”** Until then, treat this doc as exploration only.

---

## Strategic judgment

**The feeling is the product; Cline is the first host.**

A decoupled Drive Mode MCP is compelling when framed as:

1. the **agent write path** for presence + spotlight + interrupt, and
2. a **protocol** with pluggable work packs,

…not when framed as “bring back `:7891` inside cline-drivecode.”

**Best next product question (not a build order):**

> Do we want Drive to remain a Cline mode that other hosts can *also* publish into (Shape A/D), or do we want Drive Stage as a host-agnostic collaboration product that Cline consumes (Shape B/D)?

Both can share the same schemas. Only the **default writer identity** and **brand home** differ.

**Best next proof (technical, still non-binding):**

- Freeze a minimal MCP tool list that covers the five primitives.
- Point one non-Cline agent at a throwaway reference writer + HTML viewer using existing `reduceRoom`.
- Measure whether the *feeling* survives without Cline chrome.

If that proof fails, the idea was chrome and persona, not protocol. If it succeeds, extraction of `drivecode-sdk` + a `drive-mcp` adapter becomes justified by a second host — exactly the condition DEC-package-location already set.

---

## Non-goals for this brainstorm

- Replacing the active harness leverage track or hub single-writer work.
- Specifying ports, auth, multi-tenant SaaS, or WebRTC.
- Designing vertical packs beyond naming the extension point.
- Relitigating RosterPack / Team naming or AgentProfile ownership.

---

## Open forks to resolve later (if pursued)

1. **Writer identity.** Hub-only vs pluggable writer with capability flags (`mcpPublish`, `externalWriter`).
2. **Brand.** “Drive Mode” stays Cline-named vs “Drive Stage” as neutral protocol brand.
3. **Pack distribution.** In-repo coding pack only vs publishable pack registry.
4. **Subscription model.** MCP resources vs SSE/WebSocket mirror of hub events for viewers.
5. **Trust.** Which hosts may publish into a room; human approval gates for external MCP writers.

---

## Bottom line

Build the **feeling** as a small, host-agnostic **stage protocol + MCP publish API + reference viewer**, with Cline as the production-quality first writer — not as a second Cline daemon and not as a fork of the agent runtime. That keeps today’s architecture honest while opening “live reacting agents with visuals” to every MCP-capable use case.

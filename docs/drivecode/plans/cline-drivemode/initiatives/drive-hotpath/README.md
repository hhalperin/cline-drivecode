# drive-hotpath · room wire performance and hydrate correctness

**Status:** active  
**ADR:** [ADR-0029](../../adr/ADR-0029-room-hotpath-redesign.md)  
**Why:** Long-session hydrate is wrong after retention trim; call UX pays extra hops and fat snapshots under tool storms. Same wire must serve hub, PWA, and iOS.

## Keep

- Single-writer hub
- Pure `reduceRoom`
- Events-first stage
- No MCP room daemon

## Slices

| # | Work | Gate | Status |
|---|---|---|---|
| 1 | Fold checkpoint on JSONL trim; hydrate from checkpoint + tail | Cold restart after trim keeps seated humans | **wip / this track** |
| 2 | Delta `room.event` publish; full snapshot on join/gap/coalesce | Tool-storm WS payload shrinks; clients still catch up | todo |
| 3 | In-process agent→stage projector (drop critical-path `call_record_work` RTT) | Spotlight tracks tool end without second command | todo |
| 4 | Layout contract: Spotlight + strip + sheets only | No stage height stolen by PlanEditor/bank on call surface | todo |
| 5 | Cloud signaling profile (same wire, hosted writer) | Phone real turns without local daemon — owner ADR-0016 | blocked |

## Evidence

- Retention vs fold: [24-scale-and-context](../../research/24-scale-and-context.md)
- Why edge-cache ladders do not apply to loopback hub: [26-request-latency-playbook](../../research/26-request-latency-playbook.md)
- Stage 9 px history: [drive-web](../drive-web/), [21-operator-experience](../../research/21-operator-experience.md)

## Hand back

Ship slice 1 first (correctness). Do not start slice 5 without owner accept on hosted hub. MCP stays an agent tool plane, not the phone session bus.

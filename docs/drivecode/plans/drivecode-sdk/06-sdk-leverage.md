# Leveraging the Drive harness (`@cline/drive`) vs `@cline/sdk`

Back to [README.md](README.md). Architecture: [02-architecture.md](02-architecture.md). Consumption: [04-relationship-to-cline-drivecode.md](04-relationship-to-cline-drivecode.md).

## Two SDKs (do not conflate)

| Package | Role |
|---|---|
| `@cline/sdk` | Alias for `@cline/core` — agent loop, sessions, tools, hub client |
| `@cline/drive` | Drive harness (role name **drivecode-sdk**) — rooms, stage, director policies, host port |

Product Drive surfaces (`apps/cline-hub`, CLI Drive chrome) should compose **`createDriveHarness` + `createClineDriveHost`**, not invent a second room API beside hub wire commands.

## What we were doing

| Pattern | Problem |
|---|---|
| Hub `drive.*` / `call_*` commands only | Second surfaces (CLI, tests, remote hosts) must clone the wire protocol |
| Pure helpers imported à la carte (`planRoute`, `pickNextShow…`) | Correct for policy; missing a composition root that commits through the host |
| `createClineDriveHost` unused by product | Port existed for conformance only; handlers reimplemented seating |
| Local webview `stageReducer` | Risk of a second fold vs `reduceRoom` / `projectStage` |

## What landed

- **`createDriveHarness({ host })`** — MVP rooms API: `createOrAttach`, `addRosterPack`, `setAddress`, `raiseHand`, `setSharer`, `setSubMode`, `setSpotlight`, `onEvent`
- **`RoomOp` carries `roomId`** on every op (multi-room safe)
- **`DriveHostPort.getRoom`** for pack/spotlight reads
- **`memoryDriveHost`** for kernel tests without a hub
- **`director.*`** on the harness exposes pure Show helpers (`pickNextShow`, `planRoute`, `planShowIntents`, `advanceScriptBeat`) — live backlog commit remains `drive.show.*` until a DirectorPort exists
- **Webview single fold** — `useDriveSession` folds `drive_event` via `foldIncomingDriveEvent` → `reduceRoom`; demo `stageReducer` maps tools → `work.*` → same fold
- **Hub room ops via harness** — `call_join` → `createOrAttach`; `call_raise_hand` / `call_set_address` / `call_set_stage` / `call_set_mode` via `getHubDriveHarness`
- **Hub show ops via harness** — `drive.show.enqueue|present|tick` → `harness.shows.*` / `commitDirectorOp`; show runtime extracted to `driveShowRuntime.ts` (no handlers ↔ directorOps cycle)

## How to use it

```ts
import { createDriveHarness } from "@cline/drive";
import { createClineDriveHost } from "@cline/core"; // hub binding

const host = createClineDriveHost({ configParent: workspaceRoot });
const drive = createDriveHarness({
  host,
  resolveRosterPack: async (packId) => { /* pack seats */ return []; },
});
await drive.start();

const room = await drive.rooms.createOrAttach({
  humanId: "drive:human",
  humanDisplayName: "You",
});
await drive.rooms.setAddress(room.roomId, {
  mode: "agents",
  agentIds: ["drive:partner"],
});
```

Apps still **project** with `reduceRoom` / `projectStage` / `projectRoster` from the same package — one fold.

## Remaining leverage (this PR track)

Ordered slices for follow-on work after the harness MVP:

1. ~~**Hub join via harness**~~ — Done (`call_join` → `rooms.createOrAttach`; raise-hand too).
2. ~~**Thin `drive.show.*` handlers**~~ — Done: `driveShowRuntime.ts` breaks the cycle; handlers publish only; mutate via `harness.shows.*` / `commitDirectorOp`. Still open: script attach as DirectorOp; planner full harness migration.
3. **Phase-2 pure helpers** — land `expandRosterPack`, `applySeatSourceDelta`, `capPreset`, `resolveAddress` in `@cline/drive`; wire `addRosterPack` to durable packs (not skip-if-seated stubs).
4. **Do not** dump all of `@cline/drive` into `@cline/sdk` root — keep agent vs room packages separate; optional future subpath `@cline/sdk/drive` only if publishing needs one install name.

`joinCall` remains exported for unit tests / gradual callers; product hub path is the harness.

## Status

| Item | Status |
|---|---|
| `createDriveHarness` rooms MVP | Done |
| Host `getRoom` + roomId on `RoomOp` | Done |
| Product hub migration onto harness | **Done** for join / raise-hand / address / stage / mode |
| DirectorPort / show commit on harness | **Done** for enqueue / present / tick wire path; script attach + planner still handler-local |
| Webview single fold | **Done** — `foldIncomingDriveEvent` + tool→`work.*`→`reduceRoom` in `stageReducer` |
| Phase-2 pack/address/preset helpers | Not started |

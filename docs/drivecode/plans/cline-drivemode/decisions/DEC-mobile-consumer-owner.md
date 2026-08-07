# DEC · Mobile consumer owner defaults (2026-08-07)

**Status.** Accepted  
**Date.** 2026-08-07  
**Deciders.** Harrison (owner)  
**Aligns with.** [ADR-0016](../adr/ADR-0016-distribution-and-positioning.md) (path H
amendment), [mobile-consumer](../initiatives/mobile-consumer/),
[portfolio-now](../initiatives/portfolio-now/), [ADR-0029](../adr/ADR-0029-room-hotpath-redesign.md) D5

## Context

[mobile-consumer](../initiatives/mobile-consumer/) listed five open owner
questions that blocked teaching chips, PWA naming, install sequencing, and
whether hosted phone turns were in scope. Harrison answered four on 2026-08-07
(freemium economics left open).

## Decision

1. **Hosted consumer path (path H)** — **Yes.** Amend ADR-0016 so a hosted
   single-writer hub (same Drive wire) is an accepted product path for phone /
   PWA real turns. Self-hosted Route B beta remains valid. Multi-human rooms
   stay a non-goal. Engineering track: [ADR-0029](../adr/ADR-0029-room-hotpath-redesign.md)
   D5 / [portfolio-now](../initiatives/portfolio-now/) `NOW-HOTPATH-D5`. Credential
   story still [ADR-0021](../adr/ADR-0021-drive-credential-onboarding.md).
2. **Voice default** — **Mic muted on join.** The strip Mute/Unmute control is
   the **Enable microphone** toggle (unmute = enable). Hold-to-talk teaching
   assumes muted start; do not ship hot-mic-from-beat-one as the consumer
   default. (Hub already seeds `muted: true` in `drive/types.ts`.)
3. **Home-screen / PWA display name** — **“Cline Drive”** (not “Drive” alone).
   Manifest `name` / `short_name` and splash copy use this when MC3 lands.
4. **MC3 (PWA) on the Now roadmap** — **Yes.** Install habit is not optional
   phase-8 polish; keep `NOW-PWA` in the Now sequencer.

**Still open:** freemium vs BYOK economics for hosted turns (mobile-consumer
owner Q4) — do not invent pricing UX until answered.

## Consequences

**Positive**

- Path H unblocks cloud signaling design without pretending the self-hosted
  beta already is a mass-market runtime.
- Privacy-safe voice default matches DRV-MIC / spotlight S4.
- One install brand string for MC3.

**Negative**

- Hosted path creates ops/credential work (ADR-0021) before “just open the app
  and build” is honest.
- Freemium still undefined — avoid spend UI that implies a plan.

## References

- Owner answers recorded against [portfolio-now](../initiatives/portfolio-now/)
  and [mobile-consumer open decisions](../initiatives/mobile-consumer/README.md)
- Mark / motion still [DEC-drive-mark-official](DEC-drive-mark-official.md);
  this DEC only names the **product string** on the home screen

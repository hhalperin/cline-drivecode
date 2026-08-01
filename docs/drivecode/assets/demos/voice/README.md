# Demo narration clips

Pre-rendered narration for `docs/drivecode/design/canvases/drive-product-demo.html`.

- Engine: **Kokoro-82M** (`onnx-community/Kokoro-82M-v1.0-ONNX`, q8) via `kokoro-js` — Apache-2.0 weights + code.
- Voices: Adam = `am_michael`, Riley = `af_heart` (distinct voices demo the product's per-agent `voiceSlot` concept).
- Human ("You") lines are caption/transcript-only by design — DRV-TTS: voice out is narration-only.
- Regenerate: `npm i kokoro-js`, then the prerender script from the talk track (run from a SHORT path — Windows MAX_PATH breaks the HF cache under deep directories). 24kHz WAV → `ffmpeg -q:a 4` MP3.

| clip | beat | speaker | line |
|---|---|---|---|
| 01-adam-welcome-router-fix | a1-join | Adam | Welcome to router-fix — that's my live workspace on screen. |
| 03-adam-found-the-race | a2-narration | Adam | Found the race — scheduleRetry fires twice. Watch the Spotlight. |
| 04-adam-plan-first | a3-plan | Adam | Before code, the plan — three steps, we're on two. |
| 05-adam-whole-system-amber-box | a3-arch | Adam | This diagram is the whole system — the race lives in the amber box. |
| 06-adam-diagram-stays-up | a3-edit | Adam | Diagram stays up while the edit lands below — guarding the pending flag. |
| 07-adam-green-proven | a3-test | Adam | Green — one retry per timeout, proven. |
| 08-adam-walkthrough-line-43 | a3-walk | Adam | Now the walkthrough — line 43 is the whole fix. |
| 09-adam-proof-clean-200 | a3-demo | Adam | And the proof — one retry, then a clean 200. |
| 11-adam-pausing-floor-yours | a4-pause | Adam | Heard — pausing after this tool. Floor's yours. |
| 12-riley-borrowing-spotlight | a5-sharer | Riley | Riley here — borrowing Spotlight to tighten the retry docs. |
| 14-adam-call-follows-you | a6-status | Adam | Step away — the call follows. I'm still working. |
| 15-adam-saved-here | a6-artifacts | Adam | Everything I showed is saved here — plan to capture. |
| 16-adam-leave-vs-end | a7-leave-choice | Adam | Leave keeps the room alive; End builds your handoff. |
| 17-adam-end-packs-it-up | a7-end-packet | Adam | End packs it up — done, open, resume-next. |
| 18-adam-welcome-back | a8-rejoin | Adam | Welcome back — nothing torn down. Drafting the PR body. |
| 19-adam-since-you-left | a8-since | Adam | While you were out — Riley shipped one edit; tests stayed green. |
| 20-adam-needs-your-signoff | a9-gates | Adam | The PR needs your sign-off — approval card's up. |
| 21-adam-pr-twelve-open | a9-approved | Adam | Approved — PR twelve is open, handoff attached. |
| 22-adam-call-a-team | a10-agents | Adam | Call a team once — the whole roster seats itself. |
| 23-adam-stop-resume-tomorrow | a10-stop | Adam | Stopping the room — config and history kept. Tomorrow, we resume. |

Human speech (caption-only): a2-message "Adam, find the race in scheduleRetry — show me the fix on Spotlight." · a4-steer-send "Steer: keep the guard in router.ts only — retry.ts stays docs-only." · a5-you-pin "Here's what I mean — pinning my selection."

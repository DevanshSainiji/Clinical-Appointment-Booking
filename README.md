# Real-Time Multilingual Voice AI Agent (Clinical Appointment Booking)

This repository contains a clean TypeScript implementation for the engineering assignment:
- Real-time voice pipeline for appointment booking workflows
- Multilingual handling (English, Hindi, Tamil)
- Session + long-term memory
- Tool-driven orchestration with visible traces

## Assignment Scope Covered

- Booking, rescheduling, and cancellation via a single orchestrator
- Intent routing + dialogue state management
- Three core tools only:
  - `getPatientProfile`
  - `getScheduleOptions`
  - `manageAppointment`
- Latency instrumentation from speech-end to first-audio-byte
- Trace logging for agent/tool reasoning visibility

## Engineering Decisions (Why This Design)

- **Why single orchestrator (not multi-agent):** For this assignment, the core problem is low-latency appointment execution, not open-ended task delegation. A single orchestrator avoids cross-agent handoff overhead and makes turn behavior deterministic and debuggable.
- **Why exactly 3 tools:** The appointment domain can be reduced to identity/context (`getPatientProfile`), options (`getScheduleOptions`), and state mutation (`manageAppointment`). This keeps tool contracts minimal while covering booking, rescheduling, cancellation, and conflict recovery.
- **Why two memory layers:** Session memory handles in-progress dialogue state; long-term memory stores patient history and preferences across calls. This separation prevents prompt bloat and keeps retrieval scoped.
- **Why trace-first orchestration:** Every tool decision is logged so behavior is explainable during demo and review, not treated as a black box.

## Current Architecture

```txt
.
├── README.md
├── package.json
├── .env
└── src
    ├── main.ts
    ├── runtime
    │   └── voiceAgent.ts
    ├── orchestration
    │   ├── orchestrator.ts
    │   ├── intentRouter.ts
    │   └── dialogueManager.ts
    ├── services
    │   ├── stt.ts
    │   ├── tts.ts
    │   └── llm.ts
    ├── tools
    │   ├── getPatientProfile.ts
    │   ├── getScheduleOptions.ts
    │   └── manageAppointment.ts
    ├── memory
    │   ├── sessionMemory.ts
    │   └── longTermMemory.ts
    ├── config
    │   └── prompts.ts
    └── telemetry
        ├── latency.ts
        └── traces.ts
```

## End-to-End Flow

1. Audio arrives in `voiceAgent`
2. `stt.ts` converts speech to text + language hint
3. `orchestrator.ts` routes intent and manages state
4. Orchestrator calls tools as needed
5. `llm.ts` formats final assistant response
6. `tts.ts` synthesizes response audio
7. `telemetry/latency.ts` and `telemetry/traces.ts` capture runtime evidence

## Orchestrator Decision Logic

The orchestrator runs this policy on every turn:

```txt
if intent == book:
  profile = getPatientProfile(patientId)
  options = getScheduleOptions(profile/context)
  if slot resolvable:
    manageAppointment(book, slotId, patientId)
  else:
    ask clarification / offer alternatives

if intent == reschedule:
  profile = getPatientProfile(patientId)
  options = getScheduleOptions(profile/context)
  manageAppointment(reschedule, slotId, patientId) when confirmed

if intent == cancel:
  manageAppointment(cancel, patientId)
```

All branches emit a reasoning trace with intent, tool calls, and response summary.

## Handling Real-World Messiness

Example: user changes mind mid-conversation

- **Turn 1:** "Book for tomorrow morning."
- **System state:** intent=`book`, date=`tomorrow`, awaiting slot confirmation.
- **Turn 2:** "Actually Friday evening."
- **Behavior:** intent remains booking, prior slot/date state is overwritten, fresh availability is fetched, and new options are proposed.

This behavior is managed in `dialogueManager.ts` (state updates) and `orchestrator.ts` (tool re-invocation).

## Multilingual Behavior

- STT produces text plus language hint (`en`/`hi`/`ta`).
- Intent routing uses text semantics independent of language hint.
- Active language is carried through the turn and passed to TTS.
- Preferred language can be persisted in long-term memory for returning patients.
- Mid-conversation language switch is handled by updating session language from latest turn.

## Latency Measurement

Latency is measured as **speech-end -> first-audio-byte** using runtime timestamps in `src/telemetry/latency.ts`.

- `markSpeechEnd()` is called before STT/orchestration.
- `markFirstAudioByte()` is called once TTS output is produced.
- The delta is recorded for each turn and can be reported in the demo.

## Environment Variables

Create `.env` with:

```bash
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_ROOM=clinical-appointments
```

## Run / Check

Current scripts in `package.json`:

```bash
pnpm check
pnpm build
pnpm start
```

## Engineering Notes and Tradeoffs

- **Simple over complex:** Single orchestrator instead of multi-agent fragmentation
- **Deterministic over clever:** Explicit branch policies for appointment lifecycle reduce ambiguity
- **Tool-first behavior:** Appointment actions happen through explicit tool calls
- **Scalable path:** Services and memory are isolated so provider/store swaps are straightforward
- **Low-latency focus:** Minimal call chain with instrumentation points around STT/orchestration/TTS

## Known Limitations (Current Snapshot)

- External provider integrations are lightweight stubs and should be replaced with production SDK/API clients.
- Outbound campaign scheduling is not included in this reduced structure.
- Conflict logic can be expanded with richer scheduling constraints and retries.

## Submission Checklist Mapping

- **Architecture quality:** clear separation across runtime/orchestration/services/tools/memory
- **Agentic orchestration:** centralized in `src/orchestration/orchestrator.ts`
- **Memory design:** session in `sessionMemory.ts`, long-term in `longTermMemory.ts`
- **Latency evidence:** `src/telemetry/latency.ts`
- **Reasoning visibility:** `src/telemetry/traces.ts`


# Clinical Appointment Voice Agent

Real time multilingual voice AI agent for managing clinical appointments.

![LiveKit](https://opengraph.githubassets.com/1/livekit/livekit)

Supports:

- Booking
- Rescheduling
- Cancellation
- Conflict handling (auto-suggest alternatives)

Languages: English | Hindi | Tamil

---

# Tech Stack

**Voice:** LiveKit (WebRTC)  
**AI:** OpenAI / Gemini (LLM), Deepgram / Whisper (STT), ElevenLabs / Cartesia (TTS)  
**Backend:** Node.js (TypeScript), Express / Fastify  
**Memory:** Redis (session), Postgres / MongoDB (long-term)  
**Telemetry:** Custom latency + trace logging

---

# How It Works

User Speech -> STT -> Orchestrator -> Tool -> LLM -> TTS -> Voice Output

---

# Architecture

## Orchestrator (Brain)

- Intent detection
- Slot filling (doctor, date, time)
- Context + language handling
- Tool selection

## Tools

- `getPatientProfile` -> user context
- `getScheduleOptions` -> available slots + alternatives
- `manageAppointment` -> book / reschedule / cancel

---

# Example Flow

User: *"Kal dermatologist ka appointment book karna hai"*

- Detect intent + language
- Fetch profile
- Get available slots
- Confirm selection
- Book appointment

---

# Key Features

- Real-time (<450 ms latency)
- Multilingual (EN + HI + TA)
- Handles interruptions

---

# Memory

- **Session (Redis):** current intent, slots, state
- **Long-term (Mongo DB):** history, preferences

---

# Setup

```bash
pnpm install
pnpm run dev
```

## Environment

```env
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

OPENAI_API_KEY=
ELEVEN_API_KEY=

REDIS_URL=
DATABASE_URL=
```

---

# Folder Structure

```txt
Clinical-Appointment-Booking/
├── README.md
├── package.json
├── .env
├── src/
│   ├── main.ts                     # Entry (LiveKit connection)
│   ├── runtime/                    # Voice pipeline
│   │   ├── voiceAgent.ts           # Core loop (ASR -> Orchestrator -> TTS)
│   │   └── audioPipeline.ts        # Stream handling (optional abstraction)
│   ├── orchestration/              # Brain layer
│   │   ├── orchestrator.ts         # Main decision engine
│   │   ├── intentRouter.ts         # Intent detection
│   │   └── dialogueManager.ts      # State updates (slot filling)
│   ├── services/                   # External APIs
│   │   ├── stt.ts                  # Speech-to-text
│   │   ├── tts.ts                  # Text-to-speech
│   │   └── llm.ts                  # LLM calls
│   ├── tools/                      # Business actions (STRICT)
│   │   ├── getPatientProfile.ts
│   │   ├── getScheduleOptions.ts
│   │   └── manageAppointment.ts
│   ├── memory/                     # Context layer
│   │   ├── sessionMemory.ts        # current call state
│   │   └── longTermMemory.ts       # DB integration (optional)
│   ├── config/                     # Prompts + configs
│   │   ├── prompts.ts
│   │   └── constants.ts
│   ├── telemetry/                  # Logging + latency
│   │   ├── metrics.ts
│   │   └── traces.ts
│   └── utils/                      # helpers
└── tests/                          # Clean testing layer
    ├── orchestration/
    ├── tools/
    └── runtime/
```

---

# TL;DR

- Real-time voice AI agent
- Clean 3 tool architecture
- Multilingual (English, Hindi, Tamil)
- Full appointment lifecycle support
- Built for low latency and real world usage

---

# References

- [LiveKit Voice AI quickstart](https://docs.livekit.io/agents/start/voice-ai-quickstart)
- [LiveKit models overview](https://docs.livekit.io/agents/models/)
- [LiveKit agents and handoffs](https://docs.livekit.io/agents/logic/agents-handoffs/)
- [LiveKit turn detection](https://docs.livekit.io/agents/build/turns/)
- [LiveKit testing guide](https://docs.livekit.io/agents/build/testing/)


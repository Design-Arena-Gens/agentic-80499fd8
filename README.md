# CallFlow Voice Agent

Voice-driven scheduling assistant built with Next.js for booking, rescheduling, and canceling calls and appointments. Speak or type requests and the agent handles the rest with natural language parsing, voice synthesis, and persistent scheduling.

## Features
- Conversational booking flow that extracts attendee, date, time, and notes from free-form speech or text
- Voice capture via the Web Speech API with live transcription and automatic submission
- Spoken responses using the SpeechSynthesis API with quick mute toggle
- Intelligent conflict detection, rescheduling support, and cancellable pending requests
- Persistent appointment list stored locally in the browser with quick-glance sidebar

## Project Structure
```
voice-agent/
├─ src/app/page.tsx         # Voice assistant UI and interaction logic
├─ src/app/page.module.css  # Styling for chat and sidebar
├─ src/app/globals.css      # Global design tokens and resets
├─ package.json             # Scripts and dependencies
└─ public/                  # Static assets
```

## Local Development
```bash
cd voice-agent
npm install
npm run dev
# open http://localhost:3000
```

## Quality Checks
```bash
npm run lint
npm run build
```

## Deployment
Deploy to Vercel with:
```bash
vercel deploy --prod --yes --token $VERCEL_TOKEN --name agentic-80499fd8
```

After deployment verifies, the app is served from `https://agentic-80499fd8.vercel.app`.

# CallFlow Voice Agent

CallFlow is a Next.js application that delivers an AI-inspired voice agent for booking and managing calls. Users can speak or type natural requests, and the assistant extracts the relevant details to create, reschedule, or cancel appointments in real time.

## Capabilities
- **Voice capture**: Uses the Web Speech API (when available) to capture spoken requests with live transcription.
- **Smart parsing**: Leverages `chrono-node` and lightweight heuristics to interpret people, date/time, and topics.
- **Conflict handling**: Detects overlapping events, supports rescheduling flows, and cancels on demand.
- **Voice feedback**: Replies are read aloud using speech synthesis with a quick mute toggle.
- **Persistent schedule**: Upcoming calls are stored in localStorage and displayed in a clean sidebar.

## Getting Started
```bash
npm install
npm run dev
```
Visit [http://localhost:3000](http://localhost:3000) to interact with the agent. Speech recognition works best in Chrome/Edge and requires microphone permission. All functionality is also accessible via text.

## Scripts
- `npm run dev` – Start the development server.
- `npm run build` – Create an optimized production build.
- `npm run start` – Serve the production build.
- `npm run lint` – Run ESLint with the Next.js config.

## Environment
No backend services or environment variables are required. Appointments are stored locally in the browser for quick demos and Vercel deployments.

## Deployment
Run a production deploy on Vercel with:
```bash
vercel deploy --prod --yes --token $VERCEL_TOKEN --name agentic-80499fd8
```
After a successful deploy, verify with:
```bash
curl https://agentic-80499fd8.vercel.app
```

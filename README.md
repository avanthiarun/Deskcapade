# Deskcapade

Deskcapade: scan your desk, play your desk. An AI-generated pixel platformer powered by Perceptron’s vision models.

Hackathon game for the Perceptron track: scan a real desk with a phone or laptop camera, and the detected objects become a pixel platformer world for a little garden sprite (cans become vines, mugs become pools, erasers become mushrooms). **Story** mode is live; **Challenge** mode freezes one photo into a timed level. Open `/play` for a test level that needs no camera.

## Setup

Requires **Node 18+**.

```bash
npm install
cp .env.example .env
npm run dev
```

This starts:

- API on `http://localhost:8787`
- Vite (HTTPS) on `https://localhost:5173` (and a LAN URL)

The console prints **MOCK** or **LIVE** mode. Mock is used when `USE_MOCK=true`, the API key is missing, or the key is still `your-api-key-here`.

Paste a real key into `.env` as `PERCEPTRON_API_KEY` for live detection. Never commit `.env`.

**Challenge course designer (optional, free):** add `GEMINI_API_KEY` from https://aistudio.google.com/apikey to `.env` (model: `GEMINI_MODEL`, default `gemini-flash-latest`). Gemini then plans each Challenge course from your desk photo. Without a key, the game designs courses itself.

## Phone access (Milestone 1)

The phone **only talks to Vite**. Vite proxies `/api` to the backend. Camera access requires **HTTPS**.

1. Laptop and phone on the same Wi‑Fi.
2. In the Vite terminal, copy the **Network** URL, e.g. `https://192.168.x.x:5173`.
3. On the phone, open `https://<laptop-ip>:5173/capture`.
4. Accept the self-signed certificate warning (see troubleshooting), then allow the camera.

You should see the rear camera, a Scan button, Auto-scan, and (in mock mode) jittering boxes plus a **MOCK** badge.

## Verify the Perceptron key

```bash
npx tsx server/scripts/testDetect.ts ./some-image.jpg
```

Prints detections from `POST /v1/detect`. Uses the key in `.env`; it does not use mock mode.

## Tunnel fallback

If the phone will not trust Vite’s self-signed cert, or you are on guest Wi‑Fi that blocks device-to-device traffic, expose Vite with a public HTTPS URL:

**cloudflared**

```bash
cloudflared tunnel --url https://localhost:5173
```

**ngrok**

```bash
ngrok http https://localhost:5173
```

Open the printed `https://…` URL on the phone, then go to `/capture`. The browser talks to the tunnel; Vite still proxies `/api` locally.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API (`tsx watch`) + Vite HTTPS client |
| `npm run build` | Typecheck all workspaces, then Vite production build |

## Troubleshooting

**Camera permission denied**  
Allow camera for the browser. On iOS, Settings → Safari (or Chrome) → Camera.

**Not a secure context / getUserMedia missing**  
You must use `https://`, not `http://`. Use the Vite network URL or a tunnel.

**Certificate warning on the phone**  
Vite uses a self-signed cert (`@vitejs/plugin-basic-ssl`).

- Android Chrome: Advanced → proceed to the site.
- iOS Safari: often refuses self-signed certs. Use cloudflared/ngrok instead.

**Boxes never appear**  
Check the laptop console for MOCK vs LIVE. In LIVE mode, confirm `npx tsx server/scripts/testDetect.ts ./photo.jpg` works. Watch for `429` (rate limit) if Auto-scan is aggressive.

**API errors on the phone**  
The phone must reach Vite (port 5173), not 8787. Confirm `/api/health` loads as `{ "ok": true, "mock": … }`.

**Firewall**  
Allow inbound TCP 5173 (and 8787 if you hit the API from the laptop). Windows: Private network, or add an inbound rule.

**Rear camera is the selfie cam**  
Some browsers ignore `facingMode`. Switch cameras in the OS permission sheet, or rotate the phone.

## Repo layout

- `client/` — Vite + TypeScript capture UI (Phaser installed, unused until later)
- `server/` — Express scan/health API; Perceptron calls live only in `server/src/services/perceptron.ts`
- `shared/` — types shared by client and server

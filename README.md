# NSE RSI Dashboard — Backend Setup

## ⚠️ Important — about your API key
Never paste your real Groww API key/secret into chat, code comments you'll
share, or any public file. You already shared a key once — go regenerate it
in Groww's developer console before using this project, then put the NEW
key only in your local `.env` file.

## Folder structure
```
nse-rsi-backend/
  server.js          <- main Express server (don't need to edit)
  growwClient.js      <- ⚠️ EDIT THIS: plug in real Groww endpoint URLs/fields
  rsi.js              <- RSI math (don't need to edit)
  .env.example         <- copy to .env and fill in your real keys
  .gitignore           <- makes sure .env never gets committed
  public/dashboard.html <- the frontend, talks to your local backend
```

## Setup steps

1. Install Node.js if you don't have it (v18+).

2. Open terminal in the `nse-rsi-backend` folder and run:
   ```
   npm install
   ```

3. Copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```
   Open `.env` and paste your (regenerated, fresh) Groww API key + secret there.
   This file never gets uploaded anywhere or shown to anyone.

4. Open `growwClient.js` and check Groww's official API docs for:
   - The real base URL
   - The real quote/LTP endpoint path and response field names
   - The real historical-candle endpoint path and response field names
   - The real auth header format
   Replace every line marked `⚠️` with the correct values.

5. Start the backend:
   ```
   npm run dev
   ```
   You should see: `NSE RSI backend running on http://localhost:4000`

6. Open `public/dashboard.html` directly in your browser (double-click it).
   It will call your local backend automatically and show live RSI/signals.

## Rate-limit protection
The backend caches each symbol's data and will not call Groww's real API
more than once every `MIN_REFRESH_MS` (default 15 seconds, set in `.env`),
no matter how many browser tabs are open or how often the frontend polls.
You can raise this number if you want to be extra safe with your daily quota.

## Going live on a real website later
- Deploy this backend folder to Render/Railway/Vercel (Node hosting)
- In that platform's dashboard, add `GROWW_API_KEY` and `GROWW_SECRET_KEY`
  as Environment Variables (never in code)
- Change `BACKEND_URL` in `dashboard.html` to your deployed backend's URL
- Deploy `dashboard.html` (or wrap it in a small static site) to Vercel/Netlify

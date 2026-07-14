# ClearPipe — Tier 1 Prototype

Static web app. Rep fills an 11-question form, a Vercel serverless function sends the answers to Claude, the tool returns a question-led read. Nothing is stored — each session is fresh.

## Files

- `index.html` — the whole app (form + output). Inline CSS/JS, mobile-first, no build step.
- `api/analyze.js` — serverless function. Calls the Claude API with the diagnostic system prompt, returns structured JSON (`seeing`, `worthKnowing`, `nextConversation`, `gaps`, `tier2Line`).
- `package.json` — minimal, just for Vercel to recognise the project and for `vercel dev` locally.

## Environment variable

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key. Set in Vercel → Project → Settings → Environment Variables. Never put this in `index.html` or any client-side file — it lives only in the serverless function's environment. |

## Deploy to Vercel

1. Push this folder to a GitHub repo (or `vercel` CLI can deploy straight from the folder).
2. In the Vercel dashboard: **New Project** → import the repo.
3. Framework preset: **Other** (no build step needed — `index.html` is served as a static file, `api/analyze.js` is auto-detected as a serverless function).
4. Add the `ANTHROPIC_API_KEY` environment variable before the first deploy (or add it after and redeploy).
5. Deploy. Your app is live at the Vercel URL — `/` serves the form, `/api/analyze` handles the POST.

## Test locally

```bash
npm install -g vercel      # if you don't already have it
vercel login
vercel dev
```

`vercel dev` reads env vars from a `.env` file in this folder, or from ones already set in Vercel and pulled with `vercel env pull`. Create a `.env` file locally with:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Then open `http://localhost:3000` and run a deal through the form.

## What's deliberately not here yet

Tier 2 (the deeper 7-question form, confidence band, "Watch out for this" section) is designed but not wired — the button at the bottom of the output is inert on purpose. Ship Tier 1 first, confirm the a-ha lands with a real rep, then build Tier 2.

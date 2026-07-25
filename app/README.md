# Property Management Assistant

AI tools for property managers — a hackathon MVP that is **both a web app and an MCP server** in one deployment.

## Features

| Feature | What it does |
|---|---|
| 📝 **Listing Generator** | Type words/phrases describing a property → one click returns a listing-ready description **and** flags missing information (address, rent, bond, availability, bedrooms/bathrooms, furnishing, parking, minimum term) — all in a single AI call. |
| 🔍 **AI Inspection** | Upload photos taken **before the rental started** (entry condition) and current inspection photos → per-area report classifying each finding as **damage**, **fair wear and tear**, or **unchanged** — the distinction that decides bond outcomes. |
| 🔧 **Repair Verification** | Before photo (reported damage) + after photo (from the contractor) → verdict: complete / partial / not done / mismatch, with visual reasoning. |

The same three tools are exposed over the **Model Context Protocol** at `/mcp` (Streamable HTTP, stateless), so any MCP client — Claude Code, claude.ai, MCP Inspector — can call them directly.

## Run locally

```bash
cd app
npm install
cp .env.example .env   # put your ANTHROPIC_API_KEY in .env
npm run dev            # http://localhost:3000
```

## Connect to Claude (MCP)

```bash
claude mcp add --transport http propmate http://localhost:3000/mcp
```

Or point MCP Inspector at it:

```bash
npx @modelcontextprotocol/inspector
# transport: Streamable HTTP, URL: http://localhost:3000/mcp
```

## Architecture

```
Browser ──► Express ──► REST endpoints ─┐
                                        ├─► shared tools/ ──► LLM service ──► Anthropic API
MCP client ──► /mcp (Streamable HTTP) ──┘        (zod-validated)   (claude-opus-5, vision,
                                                                    structured outputs)
```

- `src/llm.ts` — the only module touching the Anthropic SDK (timeouts, retries, typed errors)
- `src/prompts/` — one file per feature: system prompt + output schema
- `src/tools/` — tool definitions shared by REST and MCP
- `src/uploads.ts` — in-memory photo store (ephemeral by design; 5 MB/image, JPEG/PNG/WebP)

## Deploy (Render free tier)

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Env var: `ANTHROPIC_API_KEY`
- Note: the free tier sleeps when idle — first visit after a while takes ~50 s.

## Limitations (hackathon MVP)

- Uploads are in-memory and cleared on restart.
- No auth or rate limiting on the public endpoints.
- Price estimation, compliance checking, and maintenance triage are on the roadmap (see `../prod-description.md`).

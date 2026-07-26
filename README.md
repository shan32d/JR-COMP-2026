# 🏠 Property Management Assistant

**AI tools for property managers — and an MCP server, in one deployment.**

Three stages of the rental lifecycle, each backed by Claude: write the listing, inspect the property, verify the repair. Every tool is available two ways — through a form-based web app anyone can use from a link, and over the **Model Context Protocol** so Claude itself can call them.

> 🔗 **Live demo:** _coming soon_ · **MCP endpoint:** `<url>/mcp`

---

## What it does

### 📝 Listing Generator
Type rough words and phrases — *"123 High St, $650/week, 2b2b, pet friendly, 3 min to train"* — and get back a listing-ready description. The **same single AI call** also checks your input against the fields tenants need (address, rent, bond, availability date, bedrooms/bathrooms, furnishing, parking, minimum term) and tells you what's missing, so nothing goes live half-written. It never invents details you didn't provide.

### 🔍 AI Inspection
Upload the photos taken **before the rental started** alongside photos from the **current inspection**. Claude compares the two sets area by area and classifies every finding as **damage**, **fair wear and tear**, or **unchanged** — the distinction that decides who pays out of the bond. Fair wear and tear (faded paint, carpet flattening in walkways) isn't the tenant's responsibility; damage (stains, holes, breakage) may be.

### 🔧 Repair Verification
The reported-damage photo goes in one side, the contractor's completion photo the other. You get a verdict — **complete / partial / not done / mismatch** — with the visual evidence behind it. "Mismatch" means the two photos aren't even of the same fixture, flagged for human review rather than quietly passed.

---

## Why it's built this way

**One tool layer, two protocols.** Each capability is defined exactly once — name, description, Zod schema, handler — and then exposed twice: as a REST endpoint behind a button in the web UI, and as an MCP tool over Streamable HTTP. There is no duplicated logic and no drift between the two surfaces.

```
Browser ──► Express ──► REST endpoints ─┐
                                        ├─► shared tools/ ──► LLM service ──► Anthropic API
MCP client ──► /mcp (Streamable HTTP) ──┘      (Zod-validated)     (claude-opus-5, vision,
                                                                   structured outputs)
```

**Before/after comparison is the core mechanic.** Both photo features work on *pairs*, not single images — a photo alone can describe a state, but only a pair can prove a change. That's what makes the output defensible in a bond dispute or a contractor dispute.

**The AI is boxed in.** Every response comes back through a JSON schema, so the UI renders structured findings rather than parsing prose. Prompts live in their own files, `max_tokens` is tuned per tool, and one module owns the Anthropic SDK — timeouts, retries, and typed errors all in one place.

---

## Tech stack

Node 20 · TypeScript · Express · Zod · [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) · [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) · vanilla JS front end (no build step, no framework)

Model: **`claude-opus-5`** — text, vision, and structured outputs.

---

## Run it locally

```bash
cd app
npm install
cp .env.example .env    # add your ANTHROPIC_API_KEY
npm run dev             # → http://localhost:3000
```

The Inspection page has a **"See an example"** button that renders a pre-generated
report from `app/fixtures/example-inspection.json` — no API key and no model call
needed, so the demo works on a cold clone. Regenerate it with the dev server up:

```bash
npm run build:example
```

## Deploy

The app is a long-lived Express server (some calls run up to ~3 minutes), so it
needs a container host rather than a serverless platform with a short request
timeout. A `Dockerfile` and a Render blueprint are included.

**Render** — dashboard → New → Blueprint → pick this repo. `render.yaml` declares
everything except `ANTHROPIC_API_KEY`, which is marked `sync: false` so Render
prompts for it in the dashboard and it never lands in the repo.

**Anywhere else that takes a Dockerfile** (Fly, Railway, Cloud Run):

```bash
docker build -t propmate .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=... propmate
```

> ⚠️ A public deployment calls the Anthropic API with **your** key on behalf of
> anyone who opens the link, and there is no auth or rate limiting in front of it.
> Put it behind access control, or keep an eye on spend.

## Use it from Claude

```bash
claude mcp add --transport http propmate http://localhost:3000/mcp
```

Or inspect it directly:

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP   URL: http://localhost:3000/mcp
```

Three tools are exposed: `generate_listing`, `inspect_condition`, `verify_repair`.

---

## Project layout

```
app/
├── src/
│   ├── index.ts          Express bootstrap — static UI, REST routes, /mcp
│   ├── mcp.ts            MCP server (stateless Streamable HTTP)
│   ├── llm.ts            the only module touching the Anthropic SDK
│   ├── uploads.ts        in-memory photo store, magic-byte validation
│   ├── validation.ts     shared Zod input rules
│   ├── prompts/          one file per feature: system prompt + output schema
│   └── tools/            tool definitions shared by REST and MCP
└── public/               the web app (HTML/CSS/JS)

prod-description.md       the product spec this was built from
```

---

## Deploying

Render free tier, from this repo:

| Setting | Value |
|---|---|
| Root Directory | `app` |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Environment | `ANTHROPIC_API_KEY` |

The free instance sleeps when idle, so the first request after a quiet spell takes ~50 s to wake.

---

## Known limitations

This is a hackathon MVP, and it's honest about what it isn't:

- **Uploads are in memory** — they're cleared when the server restarts, by design. No database.
- **No auth or rate limiting** on the public endpoints.
- **Photo analysis is decision support, not a determination.** A property manager reviews every finding; nothing is sent to tenants, owners, or contractors automatically.
- **Rental price estimation is deliberately out of scope** — credible estimates need real market data (Domain API, state rental bond datasets), and inventing numbers would be worse than omitting the feature.

## Roadmap

Compliance checking against state tenancy rules · maintenance triage with urgency classification · tenant inquiry responder · rent review against market · per-property photo history. See [`prod-description.md`](prod-description.md) for the full product thinking.

import express from "express";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { handleMcpRequest, rejectMcpMethod } from "./mcp.js";
import { generateListingTool, inspectConditionTool, verifyRepairTool } from "./tools/index.js";
import { LlmError } from "./llm.js";
import { getImage, putImage, UploadError, MAX_IMAGE_BYTES } from "./uploads.js";
import {
  addProperty,
  listProperties,
  propertyInputSchema,
  removeProperty,
  summarise,
} from "./portfolio.js";
import { buildMarketReport, fetchSuburbTenure, parseSuburb } from "./market.js";
import { generateStructuredWithSearch } from "./llm.js";
import { OUTLOOK_SYSTEM, buildOutlookPrompt, outlookSchema, type Outlook } from "./prompts/outlook.js";
import { descriptionField, photoUrlList, singlePhotoUrl, parseOrThrow, ValidationError } from "./validation.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (dev convenience; no dependency).
const envPath = path.resolve(here, "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("WARNING: ANTHROPIC_API_KEY is not set — AI features will fail.");
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------- static UI ----------
const publicDir = path.resolve(here, "..", "public");
app.use(express.static(publicDir));

// ---------- uploads ----------
app.post(
  "/api/upload",
  express.raw({ type: () => true, limit: MAX_IMAGE_BYTES + 1024 }),
  (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body)) throw new UploadError("No file received.");
      const { id } = putImage(req.body);
      res.json({ url: `/uploads/${id}` });
    } catch (err) {
      handleError(err, res);
    }
  },
);

app.get("/uploads/:id", (req, res) => {
  const img = getImage(req.params.id);
  if (!img) {
    res.status(404).json({ error: "Upload not found (uploads are temporary)." });
    return;
  }
  res.setHeader("Content-Type", img.mediaType);
  res.send(img.buffer);
});

// ---------- feature endpoints (each button maps 1:1 to a tool) ----------
const listingRequest = z.object({
  description: descriptionField,
  previous_listing: z.string().trim().max(8000).optional(),
  feedback: z.string().trim().max(1000).optional(),
});
app.post("/api/generate-listing", async (req, res) => {
  try {
    const input = parseOrThrow(listingRequest, req.body);
    res.json(await generateListingTool.handler(input));
  } catch (err) {
    handleError(err, res);
  }
});

const inspectRequest = z.object({
  entry_photo_urls: photoUrlList,
  current_photo_urls: photoUrlList,
});
app.post("/api/inspect", async (req, res) => {
  try {
    const input = parseOrThrow(inspectRequest, req.body);
    res.json(await inspectConditionTool.handler(input));
  } catch (err) {
    handleError(err, res);
  }
});

// Pre-generated report for the "see an example" button, so the demo path costs
// nothing and always renders. Regenerate with `npm run build:example`.
const examplePath = path.resolve(here, "..", "fixtures", "example-inspection.json");
if (!existsSync(examplePath)) {
  console.warn("No example inspection fixture — run `npm run build:example`.");
}

// Read per request rather than at boot: it is 12 KB off local disk, and it means
// `npm run build:example` takes effect without restarting the server.
app.get("/api/inspect/example", (_req, res) => {
  if (!existsSync(examplePath)) {
    res.status(503).json({ error: "The example report has not been generated yet." });
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.send(readFileSync(examplePath, "utf8"));
});

const repairRequest = z.object({
  before_photo_url: singlePhotoUrl,
  after_photo_url: singlePhotoUrl,
});
app.post("/api/verify-repair", async (req, res) => {
  try {
    const input = parseOrThrow(repairRequest, req.body);
    res.json(await verifyRepairTool.handler(input));
  } catch (err) {
    handleError(err, res);
  }
});

// ---------- portfolio ----------
app.get("/api/portfolio", (_req, res) => {
  res.json({ summary: summarise(), properties: listProperties() });
});

app.post("/api/portfolio", (req, res) => {
  try {
    const input = parseOrThrow(propertyInputSchema, req.body);
    const property = addProperty(input);
    res.json({ property, summary: summarise() });
  } catch (err) {
    handleError(err, res);
  }
});

app.get("/api/market/:id", async (req, res) => {
  try {
    const property = listProperties().find((p) => p.id === req.params.id);
    if (!property) {
      res.status(404).json({ error: "Property not found." });
      return;
    }
    res.json(await buildMarketReport(property.address, property.value));
  } catch (err) {
    handleError(err, res);
  }
});

/**
 * Occasionally the model skips the search and fills the schema with junk
 * (empty summary, a nonsensical range). Catch that and retry rather than
 * showing a manager fabricated numbers.
 */
function outlookLooksSound(o: Outlook, sources: { url: string }[]): boolean {
  return (
    sources.length > 0 &&
    o.low_pct <= o.base_pct &&
    o.base_pct <= o.high_pct &&
    o.low_pct >= -80 &&
    o.high_pct <= 200 &&
    o.summary.trim().length > 80 &&
    o.factors.length >= 2
  );
}

/** Slow (~60-90s): researches current reporting, then produces a ranged outlook. */
app.get("/api/market/:id/outlook", async (req, res) => {
  try {
    const property = listProperties().find((p) => p.id === req.params.id);
    if (!property) {
      res.status(404).json({ error: "Property not found." });
      return;
    }
    const tenure = await fetchSuburbTenure(property.address);
    const prompt = buildOutlookPrompt({
      address: property.address,
      suburb: tenure.matched_sa2 ?? parseSuburb(property.address).suburb,
      currentValue: property.value,
      ownerOccupierPct: tenure.owner_occupier_pct,
      rentedPct: tenure.rented_pct,
    });

    let last: { data: Outlook; sources: { title: string; url: string }[] } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      last = await generateStructuredWithSearch({
        system: OUTLOOK_SYSTEM,
        prompt,
        schema: outlookSchema,
        maxTokens: 10_000,
        maxSearches: 8,
        effort: "medium",
        timeoutMs: 150_000,
      });
      if (outlookLooksSound(last.data, last.sources)) break;
      console.warn(`Outlook attempt ${attempt + 1} looked unsound (sources=${last.sources.length}); retrying.`);
    }

    if (!last || !outlookLooksSound(last.data, last.sources)) {
      res.status(502).json({
        error: "Could not produce a grounded outlook from current reporting. Please try again.",
      });
      return;
    }
    res.json({ ...last.data, sources: last.sources.slice(0, 12), current_value: property.value });
  } catch (err) {
    handleError(err, res);
  }
});

app.delete("/api/portfolio/:id", (req, res) => {
  if (!removeProperty(req.params.id)) {
    res.status(404).json({ error: "Property not found." });
    return;
  }
  res.json({ summary: summarise() });
});

// ---------- MCP endpoint ----------
app.post("/mcp", (req, res) => {
  handleMcpRequest(req, res).catch((err) => {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  });
});
app.get("/mcp", rejectMcpMethod);
app.delete("/mcp", rejectMcpMethod);

// ---------- errors ----------
function handleError(err: unknown, res: express.Response): void {
  if (err instanceof ValidationError || err instanceof UploadError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof LlmError) {
    const status = err.code === "rate_limited" ? 429 : err.code === "timeout" ? 504 : 502;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
}

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => {
  console.log(`Property Management Assistant`);
  console.log(`  Web app:      http://localhost:${port}`);
  console.log(`  MCP endpoint: http://localhost:${port}/mcp`);
});
// Vision and web-search requests take a while; keep the HTTP timeouts above the
// LLM timeouts so Express never cuts a request short.
server.requestTimeout = 360_000;
server.headersTimeout = 370_000;

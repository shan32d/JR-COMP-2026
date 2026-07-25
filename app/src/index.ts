import express from "express";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { handleMcpRequest, rejectMcpMethod } from "./mcp.js";
import { generateListingTool, inspectConditionTool, verifyRepairTool } from "./tools/index.js";
import { LlmError } from "./llm.js";
import { getImage, putImage, UploadError, MAX_IMAGE_BYTES } from "./uploads.js";
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
const listingRequest = z.object({ description: descriptionField });
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
// Vision requests can take a while; keep the HTTP timeout above the LLM timeout.
server.requestTimeout = 120_000;

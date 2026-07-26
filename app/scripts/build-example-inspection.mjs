// Regenerates the cached example inspection served by GET /api/inspect/example.
//
// The demo button must never hit the model, so the report is generated once,
// here, and committed. Re-run this whenever the inspection prompt or schema
// changes, otherwise the example drifts from what a real run produces:
//
//   npm run dev                  # in one terminal
//   npm run build:example        # in another
//
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "fixtures");
const outFile = path.join(outDir, "example-inspection.json");

// Paths the browser will use; the server resolves them over http to read the bytes.
const ENTRY = ["/examples/before.png"];
const CURRENT = ["/examples/after.png"];

const res = await fetch(`${BASE}/api/inspect`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    entry_photo_urls: ENTRY.map((p) => BASE + p),
    current_photo_urls: CURRENT.map((p) => BASE + p),
  }),
});

const result = await res.json();
if (!res.ok) {
  console.error(`Generation failed (HTTP ${res.status}):`, result.error ?? result);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
  outFile,
  JSON.stringify(
    { generated_at: new Date().toISOString(), entry_photo_urls: ENTRY, current_photo_urls: CURRENT, result },
    null,
    2,
  ) + "\n",
);

console.log(`Wrote ${outFile}`);
console.log(`  ${result.findings.length} findings · confidence ${result.tenant_profile?.confidence}`);

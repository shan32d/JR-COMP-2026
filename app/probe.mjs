import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2];
}
const client = new Anthropic();
const t0 = Date.now();
const r = await client.messages.create({
  model: "claude-opus-5",
  max_tokens: 3000,
  tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          low_pct: { type: "number" }, base_pct: { type: "number" },
          high_pct: { type: "number" }, summary: { type: "string" },
        },
        required: ["low_pct", "base_pct", "high_pct", "summary"],
        additionalProperties: false,
      },
    },
  },
  messages: [{ role: "user", content: "Search for recent news on the Brisbane housing market and RBA interest rates, then give a 3-year price growth range for Brisbane City apartments." }],
});
console.log("stop_reason:", r.stop_reason, "| elapsed:", ((Date.now() - t0) / 1000).toFixed(1) + "s");
console.log("block types:", r.content.map((b) => b.type).join(", "));
const sr = r.content.filter((b) => b.type === "web_search_tool_result");
console.log("search result blocks:", sr.length);
if (sr.length) {
  const c = sr[0].content;
  console.log("results:", Array.isArray(c) ? c.length : "ERROR " + JSON.stringify(c).slice(0, 150));
  if (Array.isArray(c)) c.slice(0, 3).forEach((x) => console.log("  -", x.title, "|", x.url));
}
const text = r.content.find((b) => b.type === "text");
console.log("text:", text ? text.text.slice(0, 500) : "(none)");

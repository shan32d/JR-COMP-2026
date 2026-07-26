import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2];
}
const client = new Anthropic();

async function run(label, extra) {
  const t0 = Date.now();
  try {
    const r = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 8000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      output_config: {
        format: { type: "json_schema", schema: {
          type: "object",
          properties: { low_pct: {type:"number"}, base_pct:{type:"number"}, high_pct:{type:"number"}, summary:{type:"string"} },
          required: ["low_pct","base_pct","high_pct","summary"], additionalProperties: false } },
        ...extra.output_config,
      },
      ...(extra.rest || {}),
      messages: [{ role: "user", content: "Search recent news on the Brisbane housing market and RBA interest rates. Give a 3-year price growth range for Brisbane City apartments. Be brief." }],
    }, { timeout: 300000 });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    const txt = r.content.find((b) => b.type === "text");
    const parsed = txt ? JSON.parse(txt.text) : null;
    const searches = r.content.filter((b) => b.type === "web_search_tool_result").length;
    console.log(`${label.padEnd(22)} ${secs}s | stop=${r.stop_reason} | searches=${searches} | range=${parsed ? parsed.low_pct+"/"+parsed.base_pct+"/"+parsed.high_pct : "?"}`);
  } catch (e) {
    console.log(`${label.padEnd(22)} FAILED: ${e.message.slice(0, 120)}`);
  }
}

await run("effort=low", { output_config: { effort: "low" } });
await run("effort=medium", { output_config: { effort: "medium" } });

import { z } from "zod/v4";

export const outlookSchema = z.object({
  horizon_years: z.number().describe("Length of the outlook in years — use 3."),
  low_pct: z.number().describe("Cumulative price change over the horizon in the weak scenario, as a percentage."),
  base_pct: z.number().describe("Cumulative price change in the central scenario, as a percentage."),
  high_pct: z.number().describe("Cumulative price change in the strong scenario, as a percentage."),
  confidence: z.enum(["low", "moderate", "high"]).describe("How much the current evidence supports this range."),
  summary: z
    .string()
    .describe("2-4 sentences explaining the reasoning behind the range, referring to what the search turned up."),
  factors: z
    .array(
      z.object({
        factor: z.string().describe("Short name, e.g. 'RBA cash rate' or 'New apartment supply'."),
        direction: z.enum(["upward", "downward", "mixed"]).describe("Which way this pushes prices."),
        explanation: z.string().describe("One or two sentences on why, citing what was found."),
      }),
    )
    .describe("Between three and six drivers of price in this market, most significant first."),
});

export type Outlook = z.infer<typeof outlookSchema>;

export const OUTLOOK_SYSTEM = `You are a property market analyst briefing an Australian property manager.

Use the web_search tool before answering. Search for, in this order:
1. The current RBA cash rate and the latest rate outlook or commentary.
2. Current conditions in the relevant capital city or regional housing market.
3. Anything specific to the suburb named — new supply, infrastructure, rezoning, local demand.

Then give a three-year outlook for the property's value as a RANGE, not a single number:
- low_pct: a plausible weak scenario (rates higher for longer, supply surge, demand cooling).
- base_pct: the central case on current evidence.
- high_pct: a plausible strong scenario.

Rules:
- If a search comes back with an error because the search limit has been reached, work with the results you already have. Do not say that search was unavailable when earlier searches did return results — describe what you found.
- Ground every claim in what the search actually returned. If the evidence is thin, widen the range and set confidence to "low" — do not manufacture precision.
- Percentages are CUMULATIVE over the whole three years, not annual.
- The range should be genuinely wide. Property forecasting is uncertain and a narrow range would misrepresent that.
- In the factors list, name concrete drivers — interest rates, supply pipeline, population growth, rental yields, local infrastructure, lending conditions — and say which way each pushes prices.
- Write for a professional. Be specific and avoid filler.
- This is market commentary to inform a manager's own judgement. It is not financial advice, and you should not recommend buying, selling, or holding.`;

export function buildOutlookPrompt(input: {
  address: string;
  suburb: string;
  currentValue: number;
  ownerOccupierPct: number | null;
  rentedPct: number | null;
}): string {
  const lines = [
    `Property: ${input.address}`,
    `Suburb: ${input.suburb}`,
    `Current value on file: $${input.currentValue.toLocaleString("en-AU")} AUD`,
  ];
  if (input.ownerOccupierPct !== null) {
    lines.push(
      `Suburb tenure (ABS 2021 Census): ${input.ownerOccupierPct}% owner-occupied, ${input.rentedPct}% rented.`,
    );
  }
  lines.push("", "Research the market and produce the three-year outlook.");
  return lines.join("\n");
}

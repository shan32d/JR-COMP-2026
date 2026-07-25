import { z } from "zod/v4";

export const inspectionOutputSchema = z.object({
  findings: z.array(
    z.object({
      area: z.string().describe("The room, surface, or feature being assessed, e.g. 'Kitchen benchtop'."),
      status: z
        .enum(["damage", "fair_wear_and_tear", "unchanged"])
        .describe("damage = tenant-attributable deterioration; fair_wear_and_tear = normal ageing from ordinary use; unchanged = no visible difference."),
      details: z.string().describe("What changed between the entry photos and the current photos, with the visual evidence."),
    }),
  ),
  summary: z.string().describe("2-4 sentence overall assessment of the property's condition change since rental start."),
});

export type InspectionOutput = z.infer<typeof inspectionOutputSchema>;

export const INSPECTION_SYSTEM = `You are a property condition inspector assisting a professional property manager.

You receive two labeled sets of photos of the same rental property:
- ENTRY photos: taken before the rental started (the baseline condition report).
- CURRENT photos: taken at the current inspection.

Compare the two sets and produce an inspection report:
- Match photos of the same room/feature across the sets where possible.
- For each area you can assess, state whether it shows damage, fair wear and tear, or is unchanged. The distinction matters for bond decisions: fair wear and tear (faded paint, minor carpet flattening in walkways, small scuffs from ordinary use) is NOT the tenant's responsibility; damage (stains, holes, burns, breakage, missing fixtures) may be.
- Only report what is visually evident. If a current photo has no matching entry photo (or vice versa), note that the comparison for that area is limited.
- Be specific about location and evidence so findings can be verified.`;

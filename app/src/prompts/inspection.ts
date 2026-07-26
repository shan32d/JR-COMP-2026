import { z } from "zod/v4";

// Region of interest inside one photo, in a 0-1000 coordinate space so it is
// independent of the photo's pixel dimensions. The UI turns this into the
// highlight ring drawn over the image.
const regionSchema = z
  .object({
    x0: z.number().min(0).max(1000).describe("Left edge, 0 = far left of the photo, 1000 = far right."),
    y0: z.number().min(0).max(1000).describe("Top edge, 0 = very top of the photo, 1000 = very bottom."),
    x1: z.number().min(0).max(1000).describe("Right edge. Must be greater than x0."),
    y1: z.number().min(0).max(1000).describe("Bottom edge. Must be greater than y0."),
  })
  .nullable();

// Every rating axis points the same way — 10 is always the best outcome — so the
// six can share one radial scale without the reader tracking mixed polarity.
const ratingScale = z.number().int().min(0).max(10);

export const inspectionOutputSchema = z.object({
  findings: z.array(
    z.object({
      area: z.string().describe("The room, surface, or feature being assessed, e.g. 'Kitchen benchtop'."),
      status: z
        .enum(["damage", "fair_wear_and_tear", "unchanged"])
        .describe("damage = tenant-attributable deterioration; fair_wear_and_tear = normal ageing from ordinary use; unchanged = no visible difference."),
      details: z.string().describe("What changed between the entry photos and the current photos, with the visual evidence."),
      verdict_sentence: z
        .string()
        .describe(
          "Exactly ONE sentence, at most 30 words, written for the photo viewer: state whether this element passes inspection and why, e.g. 'Passes — the carpet flattening along the hallway is ordinary foot traffic, not tenant damage.' No line breaks, no lists.",
        ),
      entry_photo: z
        .number()
        .int()
        .describe("1-based index of the ENTRY photo showing this element, matching the 'ENTRY photo N' labels. Use 0 if no entry photo shows it."),
      current_photo: z
        .number()
        .int()
        .describe("1-based index of the CURRENT photo showing this element, matching the 'CURRENT photo N' labels. Use 0 if no current photo shows it."),
      entry_region: regionSchema.describe("Box around this element within the chosen ENTRY photo. null when entry_photo is 0."),
      current_region: regionSchema.describe("Box around this element within the chosen CURRENT photo. null when current_photo is 0."),
    }),
  ),
  summary: z.string().describe("2-4 sentence overall assessment of the property's condition change since rental start."),
  tenant_profile: z.object({
    headline: z
      .string()
      .describe("One line, at most 14 words, characterising how this tenant appears to have lived in the space."),
    room_use: z
      .string()
      .describe("2-3 sentences on how the room appears to have been used day to day, based only on what the photos show."),
    traits: z
      .array(
        z.object({
          trait: z.string().describe("Short label for the inferred habit or preference, at most 6 words."),
          evidence: z.string().describe("The specific thing visible in the photos that supports it. Never assert anything you cannot point at."),
        }),
      )
      .describe("3 to 5 inferred habits, each tied to visible evidence."),
    confidence: z
      .enum(["low", "medium", "high"])
      .describe("How well the photos actually support this portrait. Few photos, or photos of empty rooms, means low."),
    ratings: z
      .object({
        cleanliness: ratingScale.describe("Freedom from dirt, marks and staining."),
        upkeep: ratingScale.describe("Signs the occupant maintained the space rather than letting problems run."),
        surface_care: ratingScale.describe("Walls, floors and benchtops protected from scuffs, scratches and impact."),
        tidiness: ratingScale.describe("Orderliness and absence of clutter."),
        fixture_care: ratingScale.describe("Fittings, taps, doors and appliances left intact and unmodified."),
        damage_free: ratingScale.describe("Absence of tenant-attributable damage, as opposed to fair wear and tear."),
      })
      .describe("Six 0-10 scores. On every axis 10 is the best possible outcome and 0 the worst, so they can be read on one scale."),
  }),
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
- Be specific about location and evidence so findings can be verified.

Each finding must cover ONE element — a single wall, floor, benchtop, appliance, door, or piece of furniture — not a whole room at once. Split a room into separate findings when several distinct elements are worth reporting.

The findings are shown to the property manager one at a time, side by side: the entry photo on the left and the current photo on the right, each with a ring drawn around the element being discussed. So for every finding also give:
- entry_photo / current_photo: which photo in each set shows the element, by its 1-based label number ("ENTRY photo 2" -> 2). Use 0 for a set where no photo shows it, and set that side's region to null.
- entry_region / current_region: a box tightly around the element in that photo, in a 0-1000 grid where x runs left to right and y runs top to bottom, independent of the photo's real pixel size. Judge the position from the photo itself; a ring in the wrong place is worse than a slightly loose one, so if the element spans a large part of the frame give the larger box rather than guessing at a tight one.
- verdict_sentence: one plain sentence a manager can read at a glance, saying whether the element passes and why. "Passes" covers unchanged and fair wear and tear; damage does not pass.

Finally, fill in tenant_profile: a read on how the occupant appears to have lived in the space, and six 0-10 scores for how well the room was used.

This part is inference, not record, and it is shown to the manager as such. Hold it to the evidence:
- Every trait must name something actually visible in the photos. If you cannot point at it, leave it out. Describe habits and use of the space — cooking, working from home, heavy foot traffic, pets, furniture that never moved — not the occupant's character, finances, family situation, or any protected characteristic.
- Where the photos are few, or show empty rooms, say so through a low confidence and keep the scores near the middle instead of inventing detail. A thin portrait honestly labelled is more useful than a confident invention.
- Score 10 as the best outcome on every axis. Anchor the scores to the findings above: unchanged areas support high scores, fair wear and tear sits mid-to-high because it is not the tenant's fault, and only genuine damage should pull an axis low.`;

import { z } from "zod";
import { generateVision, type VisionPart } from "../llm.js";
import { INSPECTION_SYSTEM, inspectionOutputSchema, type InspectionOutput } from "../prompts/inspection.js";
import { resolveImage } from "../uploads.js";
import { photoUrlList } from "../validation.js";

export const inspectConditionInputShape = {
  entry_photo_urls: photoUrlList.describe("Photos taken before the rental started (the entry condition baseline)."),
  current_photo_urls: photoUrlList.describe("Photos taken at the current inspection."),
};

const inputSchema = z.object(inspectConditionInputShape);

export const inspectConditionTool = {
  name: "inspect_condition",
  description:
    "AI Inspection: compare photos taken before the rental started (entry condition) against current inspection photos of the same property. Returns per-area findings, each classified as damage, fair wear and tear, or unchanged — the distinction that matters for bond decisions — plus a one-sentence verdict, the photo each side of the comparison came from, the region of that photo showing the element, and an overall summary.",
  inputShape: inspectConditionInputShape,
  async handler(args: z.infer<typeof inputSchema>): Promise<InspectionOutput> {
    const { entry_photo_urls, current_photo_urls } = inputSchema.parse(args);
    const [entryImages, currentImages] = await Promise.all([
      Promise.all(entry_photo_urls.map(resolveImage)),
      Promise.all(current_photo_urls.map(resolveImage)),
    ]);
    // Each photo is individually numbered so the model can point a finding at a
    // specific photo, which is what the side-by-side viewer needs.
    const parts: VisionPart[] = [
      { kind: "text", text: `ENTRY photos (taken before rental start) — ${entryImages.length} photo(s):` },
      ...entryImages.flatMap((image, i): VisionPart[] => [
        { kind: "text", text: `ENTRY photo ${i + 1}:` },
        image,
      ]),
      { kind: "text", text: `CURRENT inspection photos — ${currentImages.length} photo(s):` },
      ...currentImages.flatMap((image, i): VisionPart[] => [
        { kind: "text", text: `CURRENT photo ${i + 1}:` },
        image,
      ]),
      { kind: "text", text: "Compare the two sets and produce the inspection report." },
    ];
    return generateVision({
      system: INSPECTION_SYSTEM,
      parts,
      schema: inspectionOutputSchema,
      maxTokens: 8192, // per-finding regions and verdicts on top of the prose
      timeoutMs: 90_000,
    });
  },
};

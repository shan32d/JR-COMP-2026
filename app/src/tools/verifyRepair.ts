import { z } from "zod";
import { generateVision, type VisionPart } from "../llm.js";
import { REPAIR_SYSTEM, repairOutputSchema, type RepairOutput } from "../prompts/repair.js";
import { resolveImage } from "../uploads.js";
import { singlePhotoUrl } from "../validation.js";

export const verifyRepairInputShape = {
  before_photo_url: singlePhotoUrl.describe("Photo of the reported damage, before the repair."),
  after_photo_url: singlePhotoUrl.describe("Photo submitted by the contractor after completing the work."),
};

const inputSchema = z.object(verifyRepairInputShape);

export const verifyRepairTool = {
  name: "verify_repair",
  description:
    "Verify contractor work using before/after photo comparison: the 'before' photo shows the reported damage, the 'after' photo comes from the contractor. Returns a verdict — complete, partial, not_done, or mismatch (photos show different fixtures/areas, flagged for human review) — with visual reasoning.",
  inputShape: verifyRepairInputShape,
  async handler(args: z.infer<typeof inputSchema>): Promise<RepairOutput> {
    const { before_photo_url, after_photo_url } = inputSchema.parse(args);
    const [before, after] = await Promise.all([
      resolveImage(before_photo_url),
      resolveImage(after_photo_url),
    ]);
    const parts: VisionPart[] = [
      { kind: "text", text: "BEFORE photo (reported damage):" },
      before,
      { kind: "text", text: "AFTER photo (submitted by the contractor):" },
      after,
      { kind: "text", text: "Verify whether the repair appears done." },
    ];
    return generateVision({
      system: REPAIR_SYSTEM,
      parts,
      schema: repairOutputSchema,
      maxTokens: 1024,
      timeoutMs: 90_000,
    });
  },
};

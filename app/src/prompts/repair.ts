import { z } from "zod/v4";

export const repairOutputSchema = z.object({
  verdict: z
    .enum(["complete", "partial", "not_done", "mismatch"])
    .describe("complete = the reported issue is fully fixed; partial = improved but not fully resolved; not_done = no meaningful change; mismatch = the after photo does not show the same fixture/area as the before photo."),
  reasoning: z.string().describe("2-4 sentences of visual evidence supporting the verdict."),
});

export type RepairOutput = z.infer<typeof repairOutputSchema>;

export const REPAIR_SYSTEM = `You are verifying completed maintenance work for a professional property manager.

You receive two labeled photos:
- BEFORE: the reported damage or defect.
- AFTER: the photo submitted by the contractor on completion.

Judge whether the repair appears done:
- First confirm both photos show the same fixture, area, and angle-of-subject. If they clearly do not, the verdict is "mismatch" — flag it for human review.
- Otherwise compare the defect visible in the BEFORE photo against the AFTER photo and decide: complete, partial, or not_done.
- Base the verdict only on visual evidence; say what you can and cannot see.`;

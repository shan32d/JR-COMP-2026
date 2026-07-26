import { z } from "zod";
import { generateStructured } from "../llm.js";
import { LISTING_SYSTEM, listingOutputSchema, type ListingOutput } from "../prompts/listing.js";
import { descriptionField } from "../validation.js";

export const generateListingInputShape = {
  description: descriptionField.describe(
    "The property details — either free text, or labelled lines such as 'Address: 123 High St' / 'Weekly rent: $650'.",
  ),
  previous_listing: z
    .string()
    .trim()
    .max(8000)
    .optional()
    .describe("A listing produced earlier, to be revised. Send together with `feedback`."),
  feedback: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe("What to change about `previous_listing`, e.g. 'shorter, and lead with the river views'."),
};

const inputSchema = z.object(generateListingInputShape);

function buildPrompt(input: z.infer<typeof inputSchema>): string {
  const { description, previous_listing, feedback } = input;
  if (!previous_listing || !feedback) return description;
  return [
    "PROPERTY DETAILS:",
    description,
    "",
    "PREVIOUS DRAFT:",
    previous_listing,
    "",
    "REQUESTED CHANGES:",
    feedback,
  ].join("\n");
}

export const generateListingTool = {
  name: "generate_listing",
  description:
    "Turn property details into a comprehensive, listing-ready description. The same call also checks the input against required listing fields (address, rent, bond, availability, bedrooms/bathrooms, furnishing, parking, minimum term) and returns any missing information the property manager should add. Pass `previous_listing` plus `feedback` to revise an earlier draft instead of writing a new one.",
  inputShape: generateListingInputShape,
  async handler(args: z.infer<typeof inputSchema>): Promise<ListingOutput> {
    const input = inputSchema.parse(args);
    return generateStructured({
      system: LISTING_SYSTEM,
      prompt: buildPrompt(input),
      schema: listingOutputSchema,
      maxTokens: 2048,
    });
  },
};

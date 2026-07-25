import { z } from "zod";
import { generateStructured } from "../llm.js";
import { LISTING_SYSTEM, listingOutputSchema, type ListingOutput } from "../prompts/listing.js";
import { descriptionField } from "../validation.js";

export const generateListingInputShape = {
  description: descriptionField.describe(
    "Words, phrases, or sentences describing the property, e.g. '123 High St, $650/week, 2b2b, pet friendly, near train station'.",
  ),
};

const inputSchema = z.object(generateListingInputShape);

export const generateListingTool = {
  name: "generate_listing",
  description:
    "Turn rough words/phrases describing a rental property into a comprehensive, listing-ready description. The same call also checks the input against required listing fields (address, rent, bond, availability, bedrooms/bathrooms, furnishing, parking, minimum term) and returns any missing information the property manager should add.",
  inputShape: generateListingInputShape,
  async handler(args: z.infer<typeof inputSchema>): Promise<ListingOutput> {
    const { description } = inputSchema.parse(args);
    return generateStructured({
      system: LISTING_SYSTEM,
      prompt: description,
      schema: listingOutputSchema,
      maxTokens: 2048,
    });
  },
};

import { z } from "zod";

export const descriptionField = z
  .string({ required_error: "Property description is required." })
  .trim()
  .min(10, "Please describe the property in at least 10 characters.")
  .max(4000, "Description is too long (max 4000 characters).");

const photoUrlField = z
  .string({ required_error: "Photo URL is required." })
  .trim()
  .min(1, "Photo URL is required.");

export const photoUrlList = z
  .array(photoUrlField, { required_error: "At least one photo is required." })
  .min(1, "At least one photo is required.")
  .max(10, "No more than 10 photos per set.");

export const singlePhotoUrl = photoUrlField;

/** Parse with zod and turn failures into one readable message. */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first.path.length ? `${first.path.join(".")}: ` : "";
    throw new ValidationError(`${path}${first.message}`);
  }
  return result.data;
}

export class ValidationError extends Error {}

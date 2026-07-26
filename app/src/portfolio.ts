import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ValidationError } from "./validation.js";

/**
 * In-memory portfolio of properties under management. Ephemeral by design,
 * like the photo store — seeded with sample properties so the dashboard is
 * never empty.
 *
 * Values and rents are entered by the manager; nothing here is AI-estimated.
 * Yield is plain arithmetic: annual rent / value.
 */

export const propertyInputSchema = z.object({
  address: z.string().trim().min(3, "Address is required.").max(200),
  value: z
    .number({ invalid_type_error: "Property value must be a number." })
    .positive("Property value must be greater than zero.")
    .max(1_000_000_000),
  weekly_rent: z
    .number({ invalid_type_error: "Weekly rent must be a number." })
    .positive("Weekly rent must be greater than zero.")
    .max(100_000)
    .optional(),
  status: z.enum(["rented", "vacant"]),
});

export type PropertyInput = z.infer<typeof propertyInputSchema>;

export interface Property extends PropertyInput {
  id: string;
  /** Gross annual yield as a percentage, or null when vacant / rent unknown. */
  yield_pct: number | null;
}

const MAX_PROPERTIES = 50;
const properties = new Map<string, Property>();

function grossYield(p: PropertyInput): number | null {
  if (p.status !== "rented" || !p.weekly_rent || p.value <= 0) return null;
  return Math.round(((p.weekly_rent * 52) / p.value) * 1000) / 10;
}

export function addProperty(input: PropertyInput): Property {
  if (properties.size >= MAX_PROPERTIES) {
    throw new ValidationError(`Portfolio is limited to ${MAX_PROPERTIES} properties in this demo.`);
  }
  const property: Property = { ...input, id: randomUUID(), yield_pct: grossYield(input) };
  properties.set(property.id, property);
  return property;
}

export function removeProperty(id: string): boolean {
  return properties.delete(id);
}

export function listProperties(): Property[] {
  return [...properties.values()];
}

export interface PortfolioSummary {
  count: number;
  rented: number;
  vacant: number;
  total_value: number;
  /** Portfolio-weighted gross yield across rented properties only. */
  average_yield_pct: number | null;
  annual_rent: number;
}

export function summarise(): PortfolioSummary {
  const all = listProperties();
  const rented = all.filter((p) => p.status === "rented" && p.weekly_rent);
  const annualRent = rented.reduce((sum, p) => sum + (p.weekly_rent ?? 0) * 52, 0);
  const rentedValue = rented.reduce((sum, p) => sum + p.value, 0);
  return {
    count: all.length,
    rented: rented.length,
    vacant: all.length - rented.length,
    total_value: all.reduce((sum, p) => sum + p.value, 0),
    annual_rent: annualRent,
    average_yield_pct: rentedValue > 0 ? Math.round((annualRent / rentedValue) * 1000) / 10 : null,
  };
}

// Sample portfolio so the dashboard has something to show on first load.
const SEED: PropertyInput[] = [
  { address: "123 High St, Brisbane City QLD", value: 780_000, weekly_rent: 650, status: "rented" },
  { address: "8/47 Vulture St, South Brisbane QLD", value: 615_000, weekly_rent: 540, status: "rented" },
  { address: "22 Kingsford Smith Dr, Hamilton QLD", value: 1_240_000, weekly_rent: 890, status: "rented" },
  { address: "14 Beach Rd, Surfers Paradise QLD", value: 950_000, status: "vacant" },
];

for (const seed of SEED) addProperty(seed);

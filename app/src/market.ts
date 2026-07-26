/**
 * Market data for a property.
 *
 * Two very different kinds of data live here, and the split is deliberate:
 *
 *  - REAL: suburb tenure (owner-occupier / rented rates) comes from the ABS
 *    2021 Census, served openly by geo.abs.gov.au. No key, no licence.
 *  - SAMPLE: value history and auction clearance are illustrative. The real
 *    sources (CoreLogic/RP Data, Domain) are licensed products with no
 *    hackathon-accessible API, so rather than pass off invented numbers as
 *    market data, everything synthetic is flagged `sample: true` and the UI
 *    labels it on screen.
 */

const ABS_G37_SA2 =
  "https://geo.abs.gov.au/arcgis/rest/services/Hosted/ABS_2021_Census_G37_SA2/FeatureServer/0/query";

const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;

export interface SuburbTenure {
  suburb: string;
  matched_sa2: string | null;
  owner_occupier_pct: number | null;
  rented_pct: number | null;
  dwellings: number | null;
  available: boolean;
  source: string;
}

export interface ValuePoint {
  year: number;
  value: number;
  projected: boolean;
}

export interface MarketReport {
  address: string;
  suburb: string;
  current_value: number;
  history: ValuePoint[];
  projection_method: string;
  cagr_pct: number;
  tenure: SuburbTenure;
  auction_clearance_pct: number;
  suburb_median_value: number;
  sample_fields: string[];
}

/** "8/47 Vulture St, South Brisbane QLD 4101" -> { suburb: "South Brisbane", state: "QLD" } */
export function parseSuburb(address: string): { suburb: string; state: string | null } {
  const segments = address.split(",").map((s) => s.trim()).filter(Boolean);
  const tail = segments.length > 1 ? segments[segments.length - 1] : address;
  const cleaned = tail.replace(/\b\d{4}\b/g, "").trim(); // drop postcode
  const stateMatch = cleaned.match(new RegExp(`\\b(${STATES.join("|")})\\b`, "i"));
  const state = stateMatch ? stateMatch[1].toUpperCase() : null;
  const suburb = cleaned.replace(new RegExp(`\\b(${STATES.join("|")})\\b`, "ig"), "").trim();
  return { suburb: suburb || cleaned, state };
}

const tenureCache = new Map<string, SuburbTenure>();

async function absQuery(where: string): Promise<Record<string, number | string>[]> {
  const params = new URLSearchParams({
    where,
    outFields: "sa2_name_2021,o_or_total,o_mtg_total,r_tot_total,total_total",
    returnGeometry: "false",
    resultRecordCount: "5",
    f: "json",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${ABS_G37_SA2}?${params}`, { signal: controller.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { features?: { attributes: Record<string, number | string> }[] };
    return (json.features ?? []).map((f) => f.attributes);
  } catch {
    return []; // ABS unreachable — the caller degrades gracefully
  } finally {
    clearTimeout(timer);
  }
}

const esc = (s: string) => s.replace(/'/g, "''");

/** Owner-occupier and rented rates for a suburb, from the ABS 2021 Census. */
export async function fetchSuburbTenure(address: string): Promise<SuburbTenure> {
  const { suburb, state } = parseSuburb(address);
  const key = `${suburb}|${state ?? ""}`;
  const cached = tenureCache.get(key);
  if (cached) return cached;

  const unavailable: SuburbTenure = {
    suburb,
    matched_sa2: null,
    owner_occupier_pct: null,
    rented_pct: null,
    dwellings: null,
    available: false,
    source: "ABS 2021 Census (G37) — no matching SA2",
  };
  if (!suburb) return unavailable;

  // Exact SA2 name first; ABS disambiguates duplicates as e.g. "Hamilton (Qld)".
  let rows = await absQuery(`sa2_name_2021='${esc(suburb)}'`);
  if (rows.length === 0) rows = await absQuery(`sa2_name_2021 LIKE '${esc(suburb)}%'`);
  if (rows.length === 0) {
    tenureCache.set(key, unavailable);
    return unavailable;
  }

  const preferred =
    (state && rows.find((r) => String(r.sa2_name_2021).toLowerCase().includes(state.toLowerCase()))) ||
    rows[0];

  const total = Number(preferred.total_total) || 0;
  const owned = Number(preferred.o_or_total) + Number(preferred.o_mtg_total);
  const rented = Number(preferred.r_tot_total);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : null);

  const result: SuburbTenure = {
    suburb,
    matched_sa2: String(preferred.sa2_name_2021),
    owner_occupier_pct: pct(owned),
    rented_pct: pct(rented),
    dwellings: total || null,
    available: total > 0,
    source: "ABS 2021 Census, table G37 (tenure by SA2)",
  };
  tenureCache.set(key, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* Everything below is SAMPLE data — deterministic per address so the   */
/* same property always shows the same illustrative curve.              */
/* ------------------------------------------------------------------ */

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Deterministic pseudo-random sequence in [0,1). */
function seeded(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const HISTORY_YEARS = 8;
const PROJECTION_YEARS = 3;

export async function buildMarketReport(address: string, currentValue: number): Promise<MarketReport> {
  const rand = seeded(hash(address));
  const thisYear = new Date().getFullYear();

  // Walk backwards from today's value with plausible year-on-year moves.
  const yearlyGrowth: number[] = [];
  for (let i = 0; i < HISTORY_YEARS - 1; i++) {
    yearlyGrowth.push(0.02 + rand() * 0.09); // 2%–11% p.a.
  }
  const values: number[] = [currentValue];
  for (let i = yearlyGrowth.length - 1; i >= 0; i--) {
    values.unshift(values[0] / (1 + yearlyGrowth[i]));
  }

  const history: ValuePoint[] = values.map((v, i) => ({
    year: thisYear - (HISTORY_YEARS - 1) + i,
    value: Math.round(v / 1000) * 1000,
    projected: false,
  }));

  // Projection: compound the trailing growth rate of the series above.
  const first = history[0].value;
  const last = history[history.length - 1].value;
  const cagr = Math.pow(last / first, 1 / (HISTORY_YEARS - 1)) - 1;
  let running = last;
  for (let i = 1; i <= PROJECTION_YEARS; i++) {
    running *= 1 + cagr;
    history.push({ year: thisYear + i, value: Math.round(running / 1000) * 1000, projected: true });
  }

  const { suburb } = parseSuburb(address);
  return {
    address,
    suburb,
    current_value: currentValue,
    history,
    cagr_pct: Math.round(cagr * 1000) / 10,
    projection_method: `Straight compounding of the ${HISTORY_YEARS}-year growth rate shown. Not a forecast.`,
    tenure: await fetchSuburbTenure(address),
    auction_clearance_pct: Math.round((52 + rand() * 26) * 10) / 10, // 52%–78%
    suburb_median_value: Math.round((currentValue * (0.85 + rand() * 0.3)) / 1000) * 1000,
    sample_fields: ["history", "projection", "auction_clearance_pct", "suburb_median_value"],
  };
}

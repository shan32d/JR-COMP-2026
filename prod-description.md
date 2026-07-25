# Property Management Assistant MCP — Product Description

An MCP server that gives AI assistants the tools to support **property managers** across the full lifecycle of a rental property: evaluate the price, advertise the property, screen inquiries, inspect the condition, manage repairs, and review the rent.

**Target user:** professional property managers handling a portfolio of rental properties on behalf of owners.

---

## Product journey

The features form a single property-management arc:

```
Evaluate price → Create listing → Respond to inquiries → Inspect condition → Manage repairs → Review rent
```

---

## Business use case 1: Evaluation

### Feature: Estimate Rental Price

Given an address and property attributes, the service suggests a rental price and explains its reasoning, in either message or report format.

**Output specification:**

- A price **range** (not a single point), e.g. `$380–$420/week`
- The **comparable listings** used, with address, price, and key attributes
- A **confidence note** describing data coverage for the area
- Clear "indicative only" framing — this is decision support, not a valuation

**Data sources (in order of preference):**

1. **Domain API** — developer program with listings and price-estimate endpoints
2. **State government rent data** — e.g. Queensland RTA median rents by suburb and dwelling type (free CSV)
3. **LLM + web search fallback** — with reduced confidence flagged in the output

### Feature: Rent Review Assistant

Reuses the price-estimate engine for tenancies already under management:

- Periodically compares current rent against the market for the area
- Flags properties where rent is significantly below (or above) market
- Drafts a **compliant rent-increase notice**, respecting state-specific minimum notice periods and frequency limits
- Gives the property manager an ongoing-value tool to report back to owners

---

## Business use case 2: Advertising the property

### Feature: Generate Listing Description

The property manager enters words, phrases, or sentences describing the property. The output is a comprehensive, listing-ready description.

**Enrichment option — "What's nearby":** during generation, the service can look up nearby facilities and points of interest (train stations, gyms, schools, parks) via the Google Maps API, present them as a selectable list, and fold the selected items into the description.

**Example**

*Input:*

> 123 High St, Brisbane City, $650 per week, bond four weeks' rent, available from July 25th 2026, 2 bed 2 bath apartment, unfurnished, one secure car space, pet friendly, air-conditioned, balcony with river views, building has gym and pool, 3 min walk to train station, 12-month lease preferred.

*Output:*

> **Modern 2-Bedroom Apartment in Brisbane City – Available Now!**
>
> $650/week | Bond: 4 weeks' rent | Available from July 25, 2026
>
> Looking for city living with space, views, and convenience? This is it!
>
> **The Space**
> Bright, modern two-bedroom, two-bathroom apartment in the heart of Brisbane city. Unfurnished, so you can make it your own, with air-conditioning throughout and a private balcony overlooking the river — the perfect spot for morning coffee. Includes one secure car space.
>
> **Resident Facilities**
> - On-site gym — keep up your fitness routine without leaving the building
> - Swimming pool for those warm Brisbane days
>
> **Location, Location, Location**
> - 3-minute walk to the train station — easy commuting anywhere in Brisbane
> - Right in Brisbane city, close to shops, cafes, restaurants, and everything the CBD has to offer
>
> **Pet Friendly 🐾**
> Got a furry friend? No problem — this home welcomes pets!
>
> 12-month lease preferred. Contact us to arrange an inspection.

### Feature: Missing-Information Reminder

After first generation, the service checks the listing against a predefined schema of critical categories — address, rent, bond, minimum rental period, availability date, number of bedrooms/bathrooms, furnishing, parking — and prompts the property manager to fill any gaps.

### Feature: Compliance Checker

Scans a draft listing (or a planned action such as a rent increase or entry notice) against state tenancy rules:

- **Listing language** — flags potentially discriminatory wording
- **Mandatory disclosures** — checks required information is present
- **Notice periods** — validates minimum notice for rent increases and property entry
- **Minimum housing standards** — e.g. Queensland's standards for repairs and property condition

This runs automatically after listing generation and is also callable on demand.

### Feature: Inquiry Responder

Drafts replies to prospective tenant questions using the listing as context, and screens inquiries against key criteria (move-in date, household size, pets) so the property manager can prioritise strong applicants. All drafts are reviewed by the property manager before sending.

---

## Business use case 3: Monitoring and Maintenance

All photo-analysis features in this use case are built on one core mechanism: **before/after photo comparison**. A single photo can describe a state; a pair of photos can prove a change.

### Feature: Maintenance Triage

The entry point for the maintenance workflow. A tenant submits a free-text issue report with photos; the service:

1. **Classifies urgency** — including whether the issue meets the legal definition of an *emergency repair* under state tenancy law
2. **Identifies the trade required** (plumber, electrician, general handyman, etc.)
3. **Drafts a work order** for the property manager to approve and send to a contractor

### Feature: AI Condition Inspection (Entry vs. Exit Comparison)

Rather than describing a single set of photos, the service compares two photo sets of the same property:

- **Entry vs. exit condition reports** — pairs photos of the same rooms/features, flags differences, and distinguishes **fair wear-and-tear from damage** — the distinction that decides bond disputes
- **Routine inspections** — compares the latest inspection photos against the previous set to surface emerging issues early
- Generates a structured inspection report with per-room findings and flagged items, each linked to its photo pair

### Feature: Repair Verification

Closes the loop on maintenance jobs using the same before/after mechanism:

- The **before** photo comes from the triage report or inspection that raised the issue
- The **after** photo is submitted by the contractor on completion
- The service compares the pair and reports whether the work appears complete, partially complete, or not done, with reasoning
- Flags mismatches (e.g. photo appears to be of a different fixture or room) for human review

---

## MCP tool surface

| Tool | Description |
|---|---|
| `estimate_rental_price(address, attributes)` | Price range, comparables, confidence note |
| `review_rent(tenancy)` | Market comparison + draft compliant rent-increase notice |
| `generate_listing(description, include_nearby?)` | Listing-ready description, optional nearby enrichment |
| `check_listing_completeness(listing)` | Missing-information report against the schema |
| `check_compliance(listing_or_action, state)` | Compliance findings with citations to the relevant rules |
| `draft_inquiry_reply(inquiry, listing)` | Draft reply + applicant screening summary |
| `triage_maintenance(report, photos)` | Urgency class, trade required, draft work order |
| `compare_condition(before_photos, after_photos)` | Entry/exit or inspection-over-time comparison report |
| `verify_repair(before_photo, after_photo)` | Completion verdict with reasoning |

---

## Scope notes

- **Human in the loop:** the service drafts and flags; the property manager approves. Nothing is sent to tenants, owners, or contractors automatically.
- **Not a valuation or legal service:** price estimates are indicative, and compliance checks are an aid, not legal advice.
- **Initial market:** Australia (state tenancy legislation, Domain API, RTA data), with the compliance rules designed as a pluggable per-jurisdiction module.

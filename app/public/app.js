"use strict";

// ---------- navigation (home wheel <-> feature views) ----------
function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === id));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-view]").forEach((el) => {
  el.addEventListener("click", () => showView(el.dataset.view));
  // wheel segments are <g> elements: make them keyboard-operable
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      showView(el.dataset.view);
    }
  });
});

document.getElementById("home-link").addEventListener("click", (e) => {
  e.preventDefault();
  showView("view-home");
});

// ---------- helpers ----------
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function validateFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) return `${file.name}: only JPEG, PNG, or WebP images are allowed.`;
  if (file.size > MAX_BYTES) return `${file.name}: larger than 5 MB.`;
  return null;
}

async function uploadFile(file) {
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Upload failed.");
  return data.url;
}

// Wire a file input to an upload list. Returns a getter for the uploaded URLs.
function wireUploads(inputId, thumbsId, errorId, { single = false } = {}) {
  const input = document.getElementById(inputId);
  const thumbs = document.getElementById(thumbsId);
  const errorEl = document.getElementById(errorId);
  let urls = [];

  input.addEventListener("change", async () => {
    errorEl.textContent = "";
    const files = Array.from(input.files || []);
    if (files.length === 0) return;
    if (single) {
      urls = [];
      thumbs.innerHTML = "";
    }
    for (const file of files) {
      const problem = validateFile(file);
      if (problem) {
        errorEl.textContent = problem;
        continue;
      }
      const img = document.createElement("img");
      img.className = "uploading";
      img.src = URL.createObjectURL(file);
      thumbs.appendChild(img);
      try {
        const url = await uploadFile(file);
        urls.push(url);
        img.classList.remove("uploading");
        img.title = file.name;
      } catch (err) {
        img.remove();
        errorEl.textContent = err.message;
      }
    }
    input.value = "";
  });

  return () => urls;
}

async function runAction(button, errorId, fn) {
  const errorEl = document.getElementById(errorId);
  errorEl.textContent = "";
  button.disabled = true;
  const label = button.textContent;
  button.textContent = "Working… (this can take up to a minute)";
  try {
    await fn();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

// ---------- Portfolio ----------
const money = (n) =>
  n >= 1_000_000 ? "$" + (n / 1_000_000).toFixed(2) + "M"
  : n >= 1_000 ? "$" + Math.round(n / 1000) + "k"
  : "$" + n;

const moneyFull = (n) => "$" + n.toLocaleString("en-AU");

function renderPortfolio({ summary, properties }) {
  // hub on the home wheel
  document.getElementById("hub-count").textContent = summary.count;
  document.getElementById("hub-unit").textContent =
    summary.count === 1 ? "property" : "properties";
  document.getElementById("hub-value").textContent = money(summary.total_value) + " value";
  document.getElementById("hub-yield").textContent =
    summary.average_yield_pct !== null ? summary.average_yield_pct + "% avg yield" : "no rented properties";

  // stat cards
  document.getElementById("portfolio-stats").innerHTML = [
    ["Properties", summary.count],
    ["Rented / vacant", summary.rented + " / " + summary.vacant],
    ["Total value", moneyFull(summary.total_value)],
    ["Annual rent", moneyFull(summary.annual_rent)],
    ["Avg gross yield", summary.average_yield_pct !== null ? summary.average_yield_pct + "%" : "—"],
  ]
    .map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join("");

  // table
  const rows = document.getElementById("portfolio-rows");
  if (properties.length === 0) {
    rows.innerHTML = `<tr><td colspan="6" class="empty">No properties yet — add one below.</td></tr>`;
    return;
  }
  rows.innerHTML = properties
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.address)}</td>` +
        `<td><span class="badge ${p.status === "rented" ? "unchanged" : "fair_wear_and_tear"}">${p.status}</span></td>` +
        `<td class="num"><button class="value-link" data-market="${p.id}" title="Value history, projection and suburb data">${moneyFull(p.value)}</button></td>` +
        `<td class="num">${p.weekly_rent ? moneyFull(p.weekly_rent) : "—"}</td>` +
        `<td class="num">${p.yield_pct !== null ? p.yield_pct + "%" : "—"}</td>` +
        `<td class="num"><button class="row-remove" data-id="${p.id}" title="Remove">×</button></td></tr>`,
    )
    .join("");
}

async function loadPortfolio() {
  try {
    renderPortfolio(await (await fetch("/api/portfolio")).json());
  } catch {
    document.getElementById("hub-count").textContent = "—";
  }
}

document.getElementById("portfolio-rows").addEventListener("click", async (e) => {
  const remove = e.target.closest(".row-remove");
  if (remove) {
    const res = await fetch("/api/portfolio/" + remove.dataset.id, { method: "DELETE" });
    if (res.ok) loadPortfolio();
    return;
  }
  const value = e.target.closest(".value-link");
  if (value) openMarket(value.dataset.market);
});

// ---------- Value & market panel ----------
let marketData = null;      // last /api/market response
let outlookData = null;     // last /api/market/:id/outlook response
let chartZoom = "annual";

function drawValueChart() {
  if (!marketData) return;
  const series = chartZoom === "quarterly" ? marketData.history_quarterly : marketData.history;
  const quarterly = chartZoom === "quarterly";
  const W = 720, H = 310, PAD = { t: 30, r: 22, b: 40, l: 68 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;

  const lastHistIdx = series.findIndex((p) => p.projected) - 1;
  const anchor = series[lastHistIdx].value;

  // If an AI outlook exists, its low/high define a cone from the last actual point.
  const bandPts = [];
  if (outlookData) {
    const steps = series.length - 1 - lastHistIdx;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      bandPts.push({
        i: lastHistIdx + s,
        low: anchor * (1 + (outlookData.low_pct / 100) * f),
        high: anchor * (1 + (outlookData.high_pct / 100) * f),
        base: anchor * (1 + (outlookData.base_pct / 100) * f),
      });
    }
  }

  const all = series.map((p) => p.value).concat(bandPts.flatMap((b) => [b.low, b.high]));
  const min = Math.min(...all) * 0.94, max = Math.max(...all) * 1.06;
  const x = (i) => PAD.l + (i / (series.length - 1)) * plotW;
  const y = (v) => PAD.t + plotH - ((v - min) / (max - min)) * plotH;

  const hist = series.slice(0, lastHistIdx + 1);
  const proj = series.slice(lastHistIdx);
  const pts = (arr, offset) => arr.map((p, i) => `${x(i + offset)},${y(p.value)}`).join(" ");
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min));

  // Label every year in quarterly mode rather than all 30+ quarters.
  const showLabel = (p, i) =>
    quarterly ? p.quarter === 1 : true;

  const band = bandPts.length
    ? `<polygon class="band" points="${bandPts.map((b) => `${x(b.i)},${y(b.high)}`).join(" ")} ${[...bandPts].reverse().map((b) => `${x(b.i)},${y(b.low)}`).join(" ")}" />
       <polyline class="band-line" points="${bandPts.map((b) => `${x(b.i)},${y(b.high)}`).join(" ")}" />
       <polyline class="band-line" points="${bandPts.map((b) => `${x(b.i)},${y(b.low)}`).join(" ")}" />`
    : "";

  document.getElementById("value-chart").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Property value history and projection">
      ${gridVals
        .map(
          (v) =>
            `<line class="grid-line" x1="${PAD.l}" y1="${y(v)}" x2="${W - PAD.r}" y2="${y(v)}" />` +
            `<text class="axis-text" x="${PAD.l - 8}" y="${y(v) + 4}" text-anchor="end">${money(Math.round(v))}</text>`,
        )
        .join("")}
      ${band}
      <polygon class="hist-area" points="${x(0)},${PAD.t + plotH} ${pts(hist, 0)} ${x(lastHistIdx)},${PAD.t + plotH}" />
      <polyline class="hist-line" points="${pts(hist, 0)}" />
      <polyline class="proj-line" points="${pts(proj, lastHistIdx)}" />
      ${series
        .map(
          (p, i) =>
            (quarterly && !p.projected && p.quarter !== 1
              ? ""
              : `<circle class="dot${p.projected ? " proj" : ""}" cx="${x(i)}" cy="${y(p.value)}" r="${quarterly ? 3 : 4}" />`) +
            (showLabel(p, i)
              ? `<text class="axis-text" x="${x(i)}" y="${H - 14}" text-anchor="middle">${p.year}</text>`
              : ""),
        )
        .join("")}
      <title>${series.map((p) => `${p.label}: ${moneyFull(p.value)}`).join("\n")}</title>
      <text class="dot-label" x="${x(lastHistIdx)}" y="${y(anchor) - 12}">${money(anchor)}</text>
      <line class="hist-line" x1="${W - 260}" y1="14" x2="${W - 238}" y2="14" />
      <text class="legend-text" x="${W - 232}" y="18">history</text>
      <line class="proj-line" x1="${W - 175}" y1="14" x2="${W - 153}" y2="14" />
      <text class="legend-text" x="${W - 147}" y="18">trend</text>
      ${outlookData ? `<rect class="band" x="${W - 100}" y="8" width="20" height="12" /><text class="legend-text" x="${W - 76}" y="18">AI range</text>` : ""}
    </svg>`;
}

document.querySelectorAll(".zoom").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".zoom").forEach((b) => b.classList.toggle("active", b === btn));
    chartZoom = btn.dataset.zoom;
    drawValueChart();
  });
});

// --- AI outlook: web search -> ranged projection + factors + articles ---
document.getElementById("outlook-btn").addEventListener("click", () => {
  if (!marketData) return;
  runAction(document.getElementById("outlook-btn"), "outlook-error", async () => {
    const res = await fetch("/api/market/" + marketData.id + "/outlook");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Outlook failed.");
    outlookData = data;

    const v = marketData.current_value;
    const card = (k, pct, cls) =>
      `<div class="range-card ${cls}"><span class="k">${k}</span>` +
      `<span class="v">${pct > 0 ? "+" : ""}${pct}%</span>` +
      `<span class="sub">${moneyFull(Math.round((v * (1 + pct / 100)) / 1000) * 1000)}</span></div>`;
    document.getElementById("outlook-range").innerHTML =
      card("Weak case", data.low_pct, "") + card("Base case", data.base_pct, "base") + card("Strong case", data.high_pct, "");

    document.getElementById("outlook-summary").textContent =
      data.summary + `  (Confidence: ${data.confidence}. Horizon: ${data.horizon_years} years.)`;

    const arrow = { upward: "▲", downward: "▼", mixed: "◆" };
    document.getElementById("outlook-factors").innerHTML = data.factors
      .map(
        (f) =>
          `<div class="factor"><span class="arrow ${f.direction}">${arrow[f.direction]}</span>` +
          `<span class="body"><strong>${escapeHtml(f.factor)}</strong><span>${escapeHtml(f.explanation)}</span></span></div>`,
      )
      .join("");

    document.getElementById("outlook-sources").innerHTML = data.sources.length
      ? data.sources
          .map((s) => {
            let host = s.url;
            try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch {}
            return `<a class="news-card" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">` +
              `${escapeHtml(s.title)}<span class="host">${escapeHtml(host)} ↗</span></a>`;
          })
          .join("")
      : `<p class="chart-note">No articles were returned by the search.</p>`;

    document.getElementById("outlook-result").classList.remove("hidden");
    drawValueChart(); // redraw with the range cone
  });
});

async function openMarket(id) {
  showView("view-value");
  document.getElementById("value-chart").innerHTML =
    `<p class="chart-note">Loading market data…</p>`;
  document.getElementById("value-stats").innerHTML = "";
  document.getElementById("outlook-result").classList.add("hidden");
  document.getElementById("outlook-error").textContent = "";
  outlookData = null;
  try {
    const m = await (await fetch("/api/market/" + id)).json();
    m.id = id;
    marketData = m;
    document.getElementById("value-address").textContent = m.address;
    document.getElementById("value-suburb").textContent = m.tenure.matched_sa2 || m.suburb;
    drawValueChart();
    document.getElementById("value-method").textContent =
      `Growth shown: ${m.cagr_pct}% a year. ${m.projection_method}`;

    const t = m.tenure;
    const cards = [
      t.available
        ? ["Owner-occupier rate", t.owner_occupier_pct + "%", "ABS Census 2021", false]
        : ["Owner-occupier rate", "—", "no ABS match for this suburb", false],
      t.available
        ? ["Rented", t.rented_pct + "%", "ABS Census 2021", false]
        : ["Rented", "—", "no ABS match", false],
      t.available ? ["Dwellings", t.dwellings.toLocaleString("en-AU"), "ABS Census 2021", false] : null,
      ["Auction clearance", m.auction_clearance_pct + "%", "sample — needs CoreLogic/Domain feed", true],
      ["Suburb median", moneyFull(m.suburb_median_value), "sample — needs CoreLogic feed", true],
    ].filter(Boolean);

    document.getElementById("value-stats").innerHTML = cards
      .map(
        ([k, v, src, sample]) =>
          `<div class="stat${sample ? " sample-stat" : ""}">` +
          `<span class="k">${k} ${sample ? '<span class="tag sample">sample</span>' : '<span class="tag real">real</span>'}</span>` +
          `<span class="v">${v}</span><span class="src">${escapeHtml(src)}</span></div>`,
      )
      .join("");
    document.getElementById("value-source").textContent = t.source;
  } catch (err) {
    document.getElementById("value-chart").innerHTML =
      `<p class="chart-note">Could not load market data: ${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById("property-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const address = document.getElementById("p-address").value.trim();
  const value = Number(document.getElementById("p-value").value);
  const status = document.getElementById("p-status").value;
  const rentRaw = document.getElementById("p-rent").value.trim();
  const errorEl = document.getElementById("portfolio-error");

  if (address.length < 3) { errorEl.textContent = "Please enter the property address."; return; }
  if (!value || value <= 0) { errorEl.textContent = "Please enter the property value."; return; }
  if (status === "rented" && !rentRaw) {
    errorEl.textContent = "A rented property needs a weekly rent — that's what the yield is calculated from.";
    return;
  }

  runAction(document.getElementById("property-btn"), "portfolio-error", async () => {
    await postJson("/api/portfolio", {
      address,
      value,
      status,
      ...(rentRaw ? { weekly_rent: Number(rentRaw) } : {}),
    });
    document.getElementById("property-form").reset();
    await loadPortfolio();
  });
});

loadPortfolio();

// ---------- Listing Generator ----------
// Each form field becomes one labelled line of the description sent to the API,
// so the backend contract (and the MCP tool) stays plain text.
const LISTING_FIELDS = [
  ["f-address", "Address"],
  ["f-type", "Property type"],
  ["f-rent", "Weekly rent"],
  ["f-beds", "Bedrooms"],
  ["f-baths", "Bathrooms"],
  ["f-bond", "Bond"],
  ["f-available", "Available from"],
  ["f-furnish", "Furnishing"],
  ["f-parking", "Parking"],
  ["f-pets", "Pets"],
  ["f-term", "Minimum term"],
  ["f-other", "Other details"],
];

const EXAMPLE_VALUES = {
  "f-address": "123 High St, Brisbane City",
  "f-type": "Apartment",
  "f-rent": "$650",
  "f-beds": "2",
  "f-baths": "2",
  "f-bond": "4 weeks' rent",
  "f-available": "2026-07-25",
  "f-furnish": "Unfurnished",
  "f-parking": "1 secure car space",
  "f-pets": "Pet friendly",
  "f-term": "12 months",
  "f-other":
    "Air-conditioned throughout, private balcony with river views, building has a gym and pool, 3 minute walk to the train station.",
};

function composeDescription() {
  return LISTING_FIELDS.map(([id, label]) => {
    const value = document.getElementById(id).value.trim();
    return value ? `${label}: ${value}` : null;
  })
    .filter(Boolean)
    .join("\n");
}

let lastListing = "";

function renderListing(data) {
  lastListing = data.listing;
  document.getElementById("listing-empty").classList.add("hidden");
  const textEl = document.getElementById("listing-text");
  textEl.textContent = data.listing;
  textEl.classList.remove("hidden");
  document.getElementById("listing-actions").classList.remove("hidden");

  const missingEl = document.getElementById("listing-missing");
  if (data.completeness.complete || data.completeness.missing.length === 0) {
    missingEl.innerHTML = `<div class="complete-card">✅ All key information is present.</div>`;
  } else {
    const items = data.completeness.missing
      .map((m) => `<li><strong>${escapeHtml(m.field)}</strong> — ${escapeHtml(m.why_it_matters)}</li>`)
      .join("");
    missingEl.innerHTML =
      `<div class="missing-card"><h4>⚠️ Missing information</h4>` +
      `<p>Fill these in on the left, then generate again:</p><ul>${items}</ul></div>`;
  }
}

document.getElementById("listing-example").addEventListener("click", (e) => {
  e.preventDefault();
  Object.entries(EXAMPLE_VALUES).forEach(([id, value]) => {
    document.getElementById(id).value = value;
  });
  document.getElementById("listing-error").textContent = "";
});

document.getElementById("listing-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const description = composeDescription();
  if (description.length < 10) {
    document.getElementById("listing-error").textContent =
      "Please fill in at least the address, or describe the property under Other details.";
    return;
  }
  runAction(document.getElementById("listing-btn"), "listing-error", async () => {
    renderListing(await postJson("/api/generate-listing", { description }));
  });
});

// --- copy ---
document.getElementById("listing-copy").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(lastListing);
  } catch {
    // clipboard API needs a secure context; fall back to a hidden textarea
    const ta = document.createElement("textarea");
    ta.value = lastListing;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  btn.textContent = "✅ Copied";
  setTimeout(() => (btn.textContent = "📋 Copy"), 1600);
});

// --- feedback: revise the draft instead of starting over ---
const feedbackBox = document.getElementById("listing-feedback-box");
const feedbackText = document.getElementById("listing-feedback-text");

document.getElementById("listing-feedback-btn").addEventListener("click", () => {
  feedbackBox.classList.remove("hidden");
  feedbackText.focus();
});
document.getElementById("listing-feedback-cancel").addEventListener("click", () => {
  feedbackBox.classList.add("hidden");
  feedbackText.value = "";
});

document.getElementById("listing-regen").addEventListener("click", () => {
  const feedback = feedbackText.value.trim();
  if (feedback.length < 3) {
    document.getElementById("listing-error").textContent = "Tell the AI what to change first.";
    return;
  }
  runAction(document.getElementById("listing-regen"), "listing-error", async () => {
    const data = await postJson("/api/generate-listing", {
      description: composeDescription(),
      previous_listing: lastListing,
      feedback,
    });
    renderListing(data);
    feedbackBox.classList.add("hidden");
    feedbackText.value = "";
  });
});

// ---------- AI Inspection ----------
const getEntryUrls = wireUploads("entry-files", "entry-thumbs", "inspect-error");
const getCurrentUrls = wireUploads("current-files", "current-thumbs", "inspect-error");

// One render path for both a live run and the cached example, so the demo can
// never drift from what a real report looks like.
function renderInspection(data, entryUrls, currentUrls, { example = false } = {}) {
  document.getElementById("inspect-example-note").classList.toggle("hidden", !example);
  document.getElementById("inspect-summary").textContent = data.summary;
  document.querySelector("#inspect-table tbody").innerHTML = data.findings
    .map(
      (f) =>
        `<tr><td>${escapeHtml(f.area)}</td>` +
        `<td><span class="badge ${f.status}">${f.status.replace(/_/g, " ")}</span></td>` +
        `<td>${escapeHtml(f.details)}</td></tr>`,
    )
    .join("");
  document.getElementById("inspect-result").classList.remove("hidden");

  // Same response, second reading of it: one element per page, photos ringed.
  loadWalkthrough(data.findings, entryUrls, currentUrls);
  renderTenantProfile(data.tenant_profile);
}

document.getElementById("inspect-btn").addEventListener("click", () => {
  const entry = getEntryUrls();
  const current = getCurrentUrls();
  const errorEl = document.getElementById("inspect-error");
  if (entry.length === 0) { errorEl.textContent = "Please upload at least one entry photo (before rental start)."; return; }
  if (current.length === 0) { errorEl.textContent = "Please upload at least one current inspection photo."; return; }
  runAction(document.getElementById("inspect-btn"), "inspect-error", async () => {
    const data = await postJson("/api/inspect", {
      entry_photo_urls: entry,
      current_photo_urls: current,
    });
    renderInspection(data, entry, current);
  });
});

// Cached report — served from disk, no model call, so this stays instant.
document.getElementById("inspect-example").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const errorEl = document.getElementById("inspect-error");
  errorEl.textContent = "";
  btn.disabled = true;
  try {
    const res = await fetch("/api/inspect/example");
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || "Could not load the example report.");
    renderInspection(payload.result, payload.entry_photo_urls, payload.current_photo_urls, { example: true });
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------- tenant portrait + room-use radar ----------
// Six axes, all scored 0-10 with 10 best, so one radial scale reads cleanly.
const RADAR_AXES = [
  ["cleanliness", "Cleanliness"],
  ["upkeep", "Upkeep"],
  ["surface_care", "Surface care"],
  ["tidiness", "Tidiness"],
  ["fixture_care", "Fixtures"],
  ["damage_free", "Damage-free"],
];

const RADAR = { cx: 165, cy: 158, r: 108, max: 10 };

// Axis i of the hexagon, starting at the top and going clockwise, at a raw
// distance from the centre. Labels sit past the outer ring, so this must not
// clamp — only radarPoint(), which plots data, does.
function pointAt(i, dist) {
  const angle = -Math.PI / 2 + (i * Math.PI) / 3;
  return [RADAR.cx + dist * Math.cos(angle), RADAR.cy + dist * Math.sin(angle)];
}

function radarPoint(i, value) {
  return pointAt(i, (Math.max(0, Math.min(value, RADAR.max)) / RADAR.max) * RADAR.r);
}

function hexPath(radius) {
  return RADAR_AXES.map((_, i) => pointAt(i, radius).map((n) => n.toFixed(1)).join(",")).join(" ");
}

function radarSvg(ratings) {
  // rings at 2/4/6/8/10 give the reader a scale without numbering every vertex
  const rings = [0.2, 0.4, 0.6, 0.8, 1]
    .map((f) => `<polygon class="tp-ring" points="${hexPath(RADAR.r * f)}" />`)
    .join("");
  const spokes = RADAR_AXES.map((_, i) => {
    const [x, y] = pointAt(i, RADAR.r);
    return `<line class="tp-spoke" x1="${RADAR.cx}" y1="${RADAR.cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" />`;
  }).join("");

  const area = RADAR_AXES.map(([key], i) => radarPoint(i, ratings[key] ?? 0).map((n) => n.toFixed(1)).join(","))
    .join(" ");

  // Mouse-only hover targets. SVG elements take focus without firing focus
  // events in some engines, so a tab stop here would be a dead affordance —
  // the always-visible score table is the keyboard and screen-reader path.
  const nodes = RADAR_AXES.map(([key, label], i) => {
    const v = ratings[key] ?? 0;
    const [x, y] = radarPoint(i, v);
    return (
      `<circle class="tp-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16" aria-hidden="true" ` +
      `data-axis="${escapeHtml(label)}" data-score="${v}"></circle>` +
      `<circle class="tp-node" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" />`
    );
  }).join("");

  const labels = RADAR_AXES.map(([, label], i) => {
    const [x, y] = pointAt(i, RADAR.r * 1.26);
    // keep the left/right labels off the plot instead of overlapping it
    const anchor = x < RADAR.cx - 6 ? "end" : x > RADAR.cx + 6 ? "start" : "middle";
    const dy = y < RADAR.cy - 6 ? "-0.2em" : y > RADAR.cy + 6 ? "0.9em" : "0.32em";
    return `<text class="tp-axis-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}" dy="${dy}" text-anchor="${anchor}">${escapeHtml(label)}</text>`;
  }).join("");

  // the viewBox is padded well past the plot so the longest axis label has room
  // to sit outside the hexagon instead of being clipped at the edge
  return (
    `<svg viewBox="-60 -10 450 336" role="img" aria-label="Room use rating across six axes, each scored out of 10">` +
    rings + spokes + `<polygon class="tp-area" points="${area}" />` + nodes + labels +
    `</svg>`
  );
}

function renderTenantProfile(profile) {
  const panel = document.getElementById("tenant-panel");
  if (!profile) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");

  document.getElementById("tp-headline").textContent = profile.headline || "";
  document.getElementById("tp-roomuse").textContent = profile.room_use || "";

  const conf = document.getElementById("tp-confidence");
  conf.textContent = `${profile.confidence || "low"} confidence`;
  conf.className = `tp-confidence ${profile.confidence || "low"}`;

  const ratings = profile.ratings || {};
  document.getElementById("tp-radar").innerHTML = radarSvg(ratings);

  const values = RADAR_AXES.map(([key]) => Number(ratings[key]) || 0);
  document.getElementById("tp-mean-val").textContent =
    (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);

  // the table carries every value, so the plot itself stays unnumbered
  document.getElementById("tp-scores-body").innerHTML = RADAR_AXES.map(
    ([key, label]) => `<tr><td>${escapeHtml(label)}</td><td>${Number(ratings[key]) || 0}</td></tr>`,
  ).join("");

  document.getElementById("tp-traits").innerHTML = (profile.traits || [])
    .map(
      (t) =>
        `<li><span class="t">${escapeHtml(t.trait)}</span><span class="e">${escapeHtml(t.evidence)}</span></li>`,
    )
    .join("");
  document.getElementById("tp-tip").textContent = "";
}

// hover / focus readout for the radar vertices
const tpRadar = document.getElementById("tp-radar");
const tpTip = document.getElementById("tp-tip");
function showRadarTip(e) {
  const hit = e.target.closest(".tp-hit");
  tpTip.innerHTML = hit
    ? `<strong>${escapeHtml(hit.dataset.axis)}</strong> — ${escapeHtml(hit.dataset.score)} / 10`
    : "";
}
tpRadar.addEventListener("mouseover", showRadarTip);
tpRadar.addEventListener("mouseout", () => (tpTip.textContent = ""));

// ---------- finding walkthrough (before | verdict | after, one element a page) ----------
const fm = {
  el: document.getElementById("finding-modal"),
  findings: [],
  entryUrls: [],
  currentUrls: [],
  i: 0,
  lastFocus: null,
};

function loadWalkthrough(findings, entryUrls, currentUrls) {
  fm.findings = findings || [];
  fm.entryUrls = entryUrls;
  fm.currentUrls = currentUrls;
  const btn = document.getElementById("inspect-walkthrough");
  btn.classList.toggle("hidden", fm.findings.length === 0);
  btn.textContent = `🔍 Walk through ${fm.findings.length} finding${fm.findings.length === 1 ? "" : "s"}`;
  if (fm.findings.length > 0) openWalkthrough(0);
}

// A 1-based photo number from the model, or 0/out-of-range when that side has
// no matching photo.
function photoAt(urls, n) {
  return Number.isInteger(n) && n >= 1 && n <= urls.length ? urls[n - 1] : null;
}

// Region boxes are in a 0-1000 grid; the overlay is stretched onto the photo
// box, so the same numbers work whatever the photo's real dimensions are.
function ringSvg(region, status) {
  if (!region) return "";
  const x0 = Math.min(region.x0, region.x1);
  const x1 = Math.max(region.x0, region.x1);
  const y0 = Math.min(region.y0, region.y1);
  const y1 = Math.max(region.y0, region.y1);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  // pad a little so the ring sits around the element, not across it
  const rx = Math.min(Math.max((x1 - x0) / 2, 45) * 1.15, 495);
  const ry = Math.min(Math.max((y1 - y0) / 2, 45) * 1.15, 495);
  const ellipse = (cls) =>
    `<ellipse class="fm-ring ${cls}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" />`;
  return (
    `<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">` +
    ellipse("halo") +
    ellipse(status) +
    `</svg>`
  );
}

function paneHtml(url, region, status, emptyText) {
  if (!url) return `<div class="fm-noimg">${escapeHtml(emptyText)}</div>`;
  return (
    `<div class="fm-fig"><img src="${escapeHtml(url)}" alt="" />` + ringSvg(region, status) + `</div>`
  );
}

function renderWalkthrough() {
  const f = fm.findings[fm.i];
  if (!f) return;
  const passes = f.status !== "damage";

  document.getElementById("fm-area").textContent = f.area;
  const badge = document.getElementById("fm-badge");
  badge.textContent = f.status.replace(/_/g, " ");
  badge.className = `badge ${f.status}`;

  const verdict = document.getElementById("fm-verdict");
  verdict.textContent = passes ? "✓ Passes inspection" : "✕ Does not pass";
  verdict.className = `fm-verdict ${passes ? "pass" : "fail"}`;
  // straight from the report — no extra model call
  document.getElementById("fm-sentence").textContent = f.verdict_sentence || f.details;

  document.getElementById("fm-before").innerHTML = paneHtml(
    photoAt(fm.entryUrls, f.entry_photo), f.entry_region, f.status,
    "No entry photo covers this element — comparison is limited.",
  );
  document.getElementById("fm-after").innerHTML = paneHtml(
    photoAt(fm.currentUrls, f.current_photo), f.current_region, f.status,
    "No current photo covers this element — comparison is limited.",
  );

  document.getElementById("fm-count").textContent = `${fm.i + 1} of ${fm.findings.length}`;
  document.getElementById("fm-prev").disabled = fm.i === 0;
  document.getElementById("fm-next").disabled = fm.i === fm.findings.length - 1;
  document.getElementById("fm-dots").innerHTML = fm.findings
    .map(
      (d, n) =>
        `<button class="fm-dot ${d.status} ${n === fm.i ? "active" : ""}" data-fm-go="${n}" ` +
        `title="${escapeHtml(d.area)}" aria-label="Finding ${n + 1}: ${escapeHtml(d.area)}"></button>`,
    )
    .join("");
}

function openWalkthrough(index) {
  if (fm.findings.length === 0) return;
  fm.i = Math.min(Math.max(index, 0), fm.findings.length - 1);
  fm.lastFocus = document.activeElement;
  fm.el.classList.remove("hidden");
  renderWalkthrough();
  document.getElementById("fm-next").focus();
}

function closeWalkthrough() {
  fm.el.classList.add("hidden");
  if (fm.lastFocus) fm.lastFocus.focus();
}

function stepWalkthrough(delta) {
  const next = fm.i + delta;
  if (next < 0 || next >= fm.findings.length) return;
  fm.i = next;
  renderWalkthrough();
}

document.getElementById("inspect-walkthrough").addEventListener("click", () => openWalkthrough(0));
document.getElementById("fm-prev").addEventListener("click", () => stepWalkthrough(-1));
document.getElementById("fm-next").addEventListener("click", () => stepWalkthrough(1));
fm.el.addEventListener("click", (e) => {
  if (e.target.closest("[data-fm-close]")) closeWalkthrough();
  const dot = e.target.closest("[data-fm-go]");
  if (dot) {
    fm.i = Number(dot.dataset.fmGo);
    renderWalkthrough();
  }
});
document.addEventListener("keydown", (e) => {
  if (fm.el.classList.contains("hidden")) return;
  if (e.key === "Escape") closeWalkthrough();
  else if (e.key === "ArrowLeft") stepWalkthrough(-1);
  else if (e.key === "ArrowRight") stepWalkthrough(1);
});

// ---------- Repair Verification ----------
const getBeforeUrls = wireUploads("before-file", "before-thumb", "repair-error", { single: true });
const getAfterUrls = wireUploads("after-file", "after-thumb", "repair-error", { single: true });

document.getElementById("repair-btn").addEventListener("click", () => {
  const before = getBeforeUrls();
  const after = getAfterUrls();
  const errorEl = document.getElementById("repair-error");
  if (before.length === 0) { errorEl.textContent = "Please upload the before photo (reported damage)."; return; }
  if (after.length === 0) { errorEl.textContent = "Please upload the after photo (from the contractor)."; return; }
  runAction(document.getElementById("repair-btn"), "repair-error", async () => {
    const data = await postJson("/api/verify-repair", {
      before_photo_url: before[0],
      after_photo_url: after[0],
    });
    const verdictEl = document.getElementById("repair-verdict");
    verdictEl.textContent = data.verdict.replace(/_/g, " ");
    verdictEl.className = `badge ${data.verdict}`;
    document.getElementById("repair-reasoning").textContent = data.reasoning;
    document.getElementById("repair-result").classList.remove("hidden");
  });
});

// ---------- misc ----------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.getElementById("mcp-cmd").textContent =
  `claude mcp add --transport http propmate ${location.origin}/mcp`;

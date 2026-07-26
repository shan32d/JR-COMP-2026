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
        `<td class="num">${moneyFull(p.value)}</td>` +
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
  const btn = e.target.closest(".row-remove");
  if (!btn) return;
  const res = await fetch("/api/portfolio/" + btn.dataset.id, { method: "DELETE" });
  if (res.ok) loadPortfolio();
});

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
    document.getElementById("inspect-summary").textContent = data.summary;
    const tbody = document.querySelector("#inspect-table tbody");
    tbody.innerHTML = data.findings
      .map(
        (f) =>
          `<tr><td>${escapeHtml(f.area)}</td>` +
          `<td><span class="badge ${f.status}">${f.status.replace(/_/g, " ")}</span></td>` +
          `<td>${escapeHtml(f.details)}</td></tr>`,
      )
      .join("");
    document.getElementById("inspect-result").classList.remove("hidden");
  });
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

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

// ---------- Listing Generator ----------
const EXAMPLE_INPUT =
  "123 High St, Brisbane City, $650 per week, bond four weeks' rent, available from July 25th 2026, " +
  "2 bed 2 bath apartment, unfurnished, one secure car space, pet friendly, air-conditioned, " +
  "balcony with river views, building has gym and pool, 3 min walk to train station, 12-month lease preferred.";

document.getElementById("listing-example").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("listing-input").value = EXAMPLE_INPUT;
});

document.getElementById("listing-btn").addEventListener("click", () => {
  const description = document.getElementById("listing-input").value.trim();
  if (description.length < 10) {
    document.getElementById("listing-error").textContent =
      "Please describe the property in at least 10 characters.";
    return;
  }
  runAction(document.getElementById("listing-btn"), "listing-error", async () => {
    const data = await postJson("/api/generate-listing", { description });
    document.getElementById("listing-text").textContent = data.listing;
    const missingEl = document.getElementById("listing-missing");
    if (data.completeness.complete || data.completeness.missing.length === 0) {
      missingEl.innerHTML = `<div class="complete-card">✅ All key information is present.</div>`;
    } else {
      const items = data.completeness.missing
        .map((m) => `<li><strong>${escapeHtml(m.field)}</strong> — ${escapeHtml(m.why_it_matters)}</li>`)
        .join("");
      missingEl.innerHTML =
        `<div class="missing-card"><h4>⚠️ Missing information</h4>` +
        `<p>Consider adding these details, then generate again:</p><ul>${items}</ul></div>`;
    }
    document.getElementById("listing-result").classList.remove("hidden");
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

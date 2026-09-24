/**
 * Room Type Intelligence — frontend application logic
 *
 * Backend contract (from main.py, unchanged):
 *   GET  /         -> health check, returns a plain string
 *   POST /predict  -> body must match the Features pydantic model exactly:
 *        { neighbourhood_group, neighbourhood, latitude, longitude, price,
 *          minimum_nights, number_of_reviews, reviews_per_month,
 *          calculated_host_listings_count, availability_365 }
 *     -> returns { predict_room_type, "probability :" }
 *
 * The response key really is "probability :" (space + colon baked into the
 * name) — that is read verbatim from the API, not a typo introduced here.
 */

(function () {
  "use strict";

  // --------------------------------------------------------------------
  // Config & constants
  // --------------------------------------------------------------------
  const DEFAULT_API_BASE = "http://127.0.0.1:8001";
  const API_BASE_KEY = "room-type-api-base";

  // best_pipeline in the notebook is a plain scikit-learn classifier, whose
  // predict_proba() columns follow classes_ in sorted order. The training
  // notebook confirms the three classes as:
  //   Entire home/apt, Private room, Shared room  (already alphabetical)
  // The API does not send labels back, so this order is what maps the
  // returned probability array to a human-readable class name.
  const ROOM_TYPES = ["Entire home/apt", "Private room", "Shared room"];
  const ROOM_TYPE_COLORS = {
    "Entire home/apt": "var(--entire)",
    "Private room": "var(--private)",
    "Shared room": "var(--shared)",
  };

  const NEIGHBOURHOODS_BY_BOROUGH = {
    Manhattan: ["Harlem", "Chelsea", "East Village", "West Village", "Upper West Side", "Upper East Side", "Hell's Kitchen", "SoHo", "Tribeca", "Financial District", "Washington Heights", "Murray Hill", "Chinatown", "Midtown"],
    Brooklyn: ["Williamsburg", "Bedford-Stuyvesant", "Bushwick", "Park Slope", "Greenpoint", "Crown Heights", "Flatbush", "Sunset Park", "Bay Ridge", "DUMBO"],
    Queens: ["Astoria", "Long Island City", "Flushing", "Jamaica", "Ridgewood", "Forest Hills", "Jackson Heights"],
    Bronx: ["Kingsbridge", "Fordham", "Mott Haven", "Riverdale"],
    "Staten Island": ["St. George", "Tompkinsville", "Stapleton", "New Brighton"],
  };

  // Field-level validators, mirroring the constraints declared on the
  // Features pydantic model in main.py.
  const VALIDATORS = {
    neighbourhood_group: (v) => (v ? null : "Select a borough."),
    neighbourhood: (v) => (v && v.trim().length > 0 ? null : "Enter a neighbourhood name."),
    latitude: (v) => rangeCheck(v, -90, 90, "Latitude must be between -90 and 90."),
    longitude: (v) => rangeCheck(v, -180, 180, "Longitude must be between -180 and 180."),
    price: (v) => (num(v) !== null && num(v) > 0 ? null : "Price must be greater than 0."),
    minimum_nights: (v) => intRangeCheck(v, 1, 365, "Must be a whole number from 1 to 365."),
    number_of_reviews: (v) => intRangeCheck(v, 0, Infinity, "Must be a whole number, 0 or more."),
    reviews_per_month: (v) => (num(v) !== null && num(v) >= 0 ? null : "Must be a number, 0 or more."),
    calculated_host_listings_count: (v) => intRangeCheck(v, 0, Infinity, "Must be a whole number, 0 or more."),
    availability_365: (v) => intRangeCheck(v, 0, 365, "Must be a whole number from 0 to 365."),
  };

  function num(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function rangeCheck(v, min, max, message) {
    const n = num(v);
    if (n === null || n < min || n > max) return message;
    return null;
  }
  function intRangeCheck(v, min, max, message) {
    const n = num(v);
    if (n === null || !Number.isInteger(n) || n < min || n > max) return message;
    return null;
  }

  // --------------------------------------------------------------------
  // Elements
  // --------------------------------------------------------------------
  const form = document.getElementById("predictForm");
  const submitBtn = document.getElementById("submitBtn");
  const formError = document.getElementById("formError");

  const boroughSelect = document.getElementById("neighbourhood_group");
  const neighbourhoodList = document.getElementById("neighbourhoodList");

  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const apiBaseInput = document.getElementById("apiBaseInput");

  const stateIdle = document.getElementById("stateIdle");
  const stateLoading = document.getElementById("stateLoading");
  const stateError = document.getElementById("stateError");
  const stateResult = document.getElementById("stateResult");
  const errorTitle = document.getElementById("errorTitle");
  const errorDetail = document.getElementById("errorDetail");

  const resultLabel = document.getElementById("resultLabel");
  const confidenceNumber = document.getElementById("confidenceNumber");
  const confidenceFill = document.getElementById("confidenceFill");
  const probBars = document.getElementById("probBars");
  const rawJson = document.getElementById("rawJson");
  const copyRawBtn = document.getElementById("copyRawBtn");

  // --------------------------------------------------------------------
  // API base URL (persisted locally; never a secret, just an endpoint)
  // --------------------------------------------------------------------
  function getApiBase() {
    return localStorage.getItem(API_BASE_KEY) || DEFAULT_API_BASE;
  }
  function setApiBase(value) {
    const trimmed = value.trim().replace(/\/+$/, "");
    localStorage.setItem(API_BASE_KEY, trimmed || DEFAULT_API_BASE);
    return getApiBase();
  }
  apiBaseInput.value = getApiBase();
  apiBaseInput.addEventListener("change", () => {
    setApiBase(apiBaseInput.value);
    apiBaseInput.value = getApiBase();
    checkApiHealth();
  });

  // --------------------------------------------------------------------
  // Neighbourhood suggestions, filtered by borough
  // --------------------------------------------------------------------
  function refreshNeighbourhoodSuggestions() {
    const list = NEIGHBOURHOODS_BY_BOROUGH[boroughSelect.value] || [];
    neighbourhoodList.innerHTML = list.map((n) => `<option value="${n}"></option>`).join("");
  }
  boroughSelect.addEventListener("change", () => {
    refreshNeighbourhoodSuggestions();
    validateField(boroughSelect);
  });

  // --------------------------------------------------------------------
  // API health check
  // --------------------------------------------------------------------
  async function checkApiHealth() {
    statusDot.classList.remove("online", "offline");
    statusText.textContent = "Checking API…";
    try {
      const res = await fetch(`${getApiBase()}/`, { method: "GET" });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      statusDot.classList.add("online");
      statusText.textContent = "API online";
    } catch (err) {
      statusDot.classList.add("offline");
      statusText.textContent = "API offline";
      console.error("Health check failed:", err);
    }
  }

  // --------------------------------------------------------------------
  // Field-level validation UI
  // --------------------------------------------------------------------
  function validateField(input) {
    const wrapper = input.closest(".field");
    const msg = document.getElementById(`msg-${input.name}`);
    const validator = VALIDATORS[input.name];
    if (!wrapper || !msg || !validator) return true;

    // don't scold an untouched, empty field on load
    if (input.value === "" && !input.dataset.touched) {
      wrapper.classList.remove("has-error", "has-success");
      msg.textContent = msg.dataset.default || "";
      msg.classList.remove("valid", "invalid");
      return false;
    }

    input.dataset.touched = "1";
    const error = validator(input.value);

    if (error) {
      wrapper.classList.add("has-error");
      wrapper.classList.remove("has-success");
      msg.textContent = `⚠ ${error}`;
      msg.classList.add("invalid");
      msg.classList.remove("valid");
      return false;
    }

    wrapper.classList.add("has-success");
    wrapper.classList.remove("has-error");
    msg.textContent = "✓ Looks good";
    msg.classList.add("valid");
    msg.classList.remove("invalid");
    return true;
  }

  Object.keys(VALIDATORS).forEach((name) => {
    const input = form.elements[name];
    if (!input) return;
    input.addEventListener("blur", () => validateField(input));
    input.addEventListener("input", () => {
      if (input.dataset.touched) validateField(input);
    });
    if (input.tagName === "SELECT") {
      input.addEventListener("change", () => validateField(input));
    }
  });

  function validateAll() {
    let allValid = true;
    Object.keys(VALIDATORS).forEach((name) => {
      const input = form.elements[name];
      if (!input) return;
      input.dataset.touched = "1";
      if (!validateField(input)) allValid = false;
    });
    return allValid;
  }

  // --------------------------------------------------------------------
  // Result panel state switching
  // --------------------------------------------------------------------
  function showState(name) {
    stateIdle.hidden = name !== "idle";
    stateLoading.hidden = name !== "loading";
    stateError.hidden = name !== "error";
    stateResult.hidden = name !== "result";
  }

  function animateCountUp(el, target, duration = 700) {
    const start = performance.now();
    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = `${Math.round(target * eased)}%`;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function renderResult(prediction, probabilities, rawBody) {
    resultLabel.textContent = prediction;
    resultLabel.style.color = ROOM_TYPE_COLORS[prediction] || "var(--text-primary)";

    const rows = ROOM_TYPES.map((label, i) => ({
      label,
      value: Array.isArray(probabilities) ? Number(probabilities[i]) || 0 : 0,
    })).sort((a, b) => b.value - a.value);

    const topConfidence = Math.round((rows[0]?.value || 0) * 100);
    confidenceFill.style.width = "0%";
    requestAnimationFrame(() => {
      confidenceFill.style.width = `${topConfidence}%`;
    });
    animateCountUp(confidenceNumber, topConfidence);

    probBars.innerHTML = rows
      .map((row) => {
        const pct = Math.round(row.value * 100);
        const color = ROOM_TYPE_COLORS[row.label] || "var(--primary)";
        return `
          <div class="prob-row">
            <div class="prob-row-top">
              <span>${row.label}</span>
              <span class="prob-value">${pct}%</span>
            </div>
            <div class="prob-track">
              <div class="prob-fill" data-target="${pct}" style="background:${color}"></div>
            </div>
          </div>`;
      })
      .join("");

    rawJson.textContent = JSON.stringify(rawBody, null, 2);

    showState("result");

    requestAnimationFrame(() => {
      probBars.querySelectorAll(".prob-fill").forEach((el) => {
        el.style.width = `${el.dataset.target}%`;
      });
    });
  }

  function renderError(title, detail) {
    errorTitle.textContent = title;
    errorDetail.textContent = detail;
    showState("error");
  }

  copyRawBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(rawJson.textContent);
      const original = copyRawBtn.textContent;
      copyRawBtn.textContent = "Copied";
      setTimeout(() => (copyRawBtn.textContent = original), 1200);
    } catch (err) {
      console.error("Clipboard write failed:", err);
    }
  });

  // --------------------------------------------------------------------
  // Payload assembly (field names/types match the Features model exactly)
  // --------------------------------------------------------------------
  function collectPayload() {
    const data = new FormData(form);
    return {
      neighbourhood_group: data.get("neighbourhood_group"),
      neighbourhood: data.get("neighbourhood"),
      latitude: Number(data.get("latitude")),
      longitude: Number(data.get("longitude")),
      price: Number(data.get("price")),
      minimum_nights: parseInt(data.get("minimum_nights"), 10),
      number_of_reviews: parseInt(data.get("number_of_reviews"), 10),
      reviews_per_month: Number(data.get("reviews_per_month")),
      calculated_host_listings_count: parseInt(data.get("calculated_host_listings_count"), 10),
      availability_365: parseInt(data.get("availability_365"), 10),
    };
  }

  function describeApiError(status, body) {
    // FastAPI/pydantic validation errors come back as { detail: [...] }
    if (body && Array.isArray(body.detail)) {
      return body.detail.map((d) => `${(d.loc || []).slice(-1)[0] || "field"}: ${d.msg}`).join("; ");
    }
    if (body && typeof body.detail === "string") return body.detail;
    return `The API responded with status ${status}.`;
  }

  // --------------------------------------------------------------------
  // Submit handler
  // --------------------------------------------------------------------
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError.textContent = "";

    if (!validateAll()) {
      formError.textContent = "Please fix the highlighted fields before predicting.";
      form.querySelector(".field.has-error input, .field.has-error select")?.focus();
      return;
    }

    const payload = collectPayload();
    submitBtn.disabled = true;
    showState("loading");

    try {
      const res = await fetch(`${getApiBase()}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let body = null;
      try {
        body = await res.json();
      } catch (_) {
        /* non-JSON response, handled below */
      }

      if (!res.ok) {
        console.error("API error response:", res.status, body);
        renderError("The prediction service returned an error", describeApiError(res.status, body));
        return;
      }

      const prediction = body && body.predict_room_type;
      const probabilities = body && body["probability :"];

      if (!prediction) {
        console.error("Unexpected API response shape:", body);
        renderError("Unexpected response", "The API responded without a prediction. Check the server logs.");
        return;
      }

      renderResult(prediction, probabilities, body);
    } catch (err) {
      console.error("Network error calling /predict:", err);
      renderError(
        "Unable to connect to the prediction service",
        `Please make sure the API server is running at ${getApiBase()}.`
      );
    } finally {
      submitBtn.disabled = false;
    }
  });

  // --------------------------------------------------------------------
  // Init
  // --------------------------------------------------------------------
  refreshNeighbourhoodSuggestions();
  checkApiHealth();
})();

/**
 * NYC Room Type Predictor — frontend logic
 *
 * Talks to the FastAPI service defined in main.py:
 *   GET  /         -> health check, returns a plain string
 *   POST /predict  -> body matches the Features pydantic model exactly,
 *                     returns { predict_room_type, "probability :" }
 *
 * Note: the API's success key really is "probability :" (with a space
 * and colon baked into the name) — that's not a typo introduced here.
 */

(function () {
  "use strict";

  // --------------------------------------------------------------------
  // Config
  // --------------------------------------------------------------------
  const DEFAULT_API_BASE = "http://127.0.0.1:8001";
  const API_BASE_KEY = "nyc-predictor-api-base";

  // The pipeline's classifier is trained with scikit-learn defaults, which
  // sort class labels alphabetically. For this dataset that order is:
  //   Entire home/apt, Private room, Shared room
  // This lets us label the probability array the API returns without the
  // API needing to send labels itself.
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
  const errorDetail = document.getElementById("errorDetail");
  const resultLabel = document.getElementById("resultLabel");
  const probBars = document.getElementById("probBars");

  // --------------------------------------------------------------------
  // API base URL (persisted so it survives a page reload)
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
    neighbourhoodList.innerHTML = list
      .map((name) => `<option value="${name}"></option>`)
      .join("");
  }
  boroughSelect.addEventListener("change", refreshNeighbourhoodSuggestions);

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
      statusText.textContent = "API connected";
    } catch (err) {
      statusDot.classList.add("offline");
      statusText.textContent = "API unreachable";
    }
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

  function renderResult(prediction, probabilities) {
    resultLabel.textContent = prediction;
    resultLabel.style.color = ROOM_TYPE_COLORS[prediction] || "var(--text)";

    const rows = ROOM_TYPES.map((label, i) => ({
      label,
      value: Array.isArray(probabilities) ? Number(probabilities[i]) || 0 : 0,
    })).sort((a, b) => b.value - a.value);

    probBars.innerHTML = rows
      .map((row) => {
        const pct = Math.round(row.value * 100);
        const color = ROOM_TYPE_COLORS[row.label] || "var(--accent)";
        return `
          <div class="prob-row">
            <div class="prob-row-top">
              <span>${row.label}</span>
              <span class="prob-value">${pct}%</span>
            </div>
            <div class="prob-track">
              <div class="prob-fill" style="width:0%; background:${color}"
                   data-target="${pct}"></div>
            </div>
          </div>`;
      })
      .join("");

    showState("result");

    // animate bars in on next frame so the transition actually plays
    requestAnimationFrame(() => {
      probBars.querySelectorAll(".prob-fill").forEach((el) => {
        el.style.width = `${el.dataset.target}%`;
      });
    });
  }

  function renderError(message) {
    errorDetail.textContent = message;
    showState("error");
  }

  // --------------------------------------------------------------------
  // Form submission
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
      return body.detail
        .map((d) => `${(d.loc || []).slice(-1)[0] || "field"}: ${d.msg}`)
        .join("; ");
    }
    if (body && typeof body.detail === "string") return body.detail;
    return `The API responded with status ${status}.`;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError.textContent = "";

    if (!form.checkValidity()) {
      form.reportValidity();
      formError.textContent = "Please fill in every field before predicting.";
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
        renderError(describeApiError(res.status, body));
        return;
      }

      const prediction = body && body.predict_room_type;
      const probabilities = body && body["probability :"];

      if (!prediction) {
        renderError("The API responded without a prediction. Check the server logs.");
        return;
      }

      renderResult(prediction, probabilities);
    } catch (err) {
      renderError(
        `Couldn't reach the API at ${getApiBase()}. Make sure the FastAPI server is running and the API base URL below is correct.`
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

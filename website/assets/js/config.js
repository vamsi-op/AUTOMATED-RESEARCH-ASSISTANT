/* ============================================================================
   ScholarAI — Runtime configuration
   Change API_BASE_URL to point the app at your FastAPI backend.
   ----------------------------------------------------------------------------
   Priority order:
     1. ?api=<url> query param (handy for testing)
     2. localStorage key "scholarai_api"
     3. window.SCHOLARAI_API (set below or injected at deploy time)
     4. same-origin  (window.location.origin) — for when the site is
        served by the FastAPI app itself.
   ============================================================================ */
(function () {
  // Fallback backend used only when the site is opened as a static file
  // (file://) or hosted separately from the API (e.g. Vercel).
  // When the FastAPI app serves this site, same-origin is used automatically.
  const FALLBACK_BACKEND = "https://vamsi-op-automated-research-assistant.hf.space";

  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("api");
  const fromStore = (function () {
    try { return localStorage.getItem("scholarai_api"); } catch (e) { return null; }
  })();

  // If served over http(s), assume the backend lives at the same origin
  // (this is the case when the FastAPI app serves the site). Otherwise
  // (file://) fall back to the public backend.
  const sameOrigin = window.location.protocol.indexOf("http") === 0
    ? window.location.origin
    : FALLBACK_BACKEND;

  const base =
    fromQuery ||
    fromStore ||
    window.SCHOLARAI_API ||
    sameOrigin;

  // Persist an explicit override so it survives navigation.
  if (fromQuery) {
    try { localStorage.setItem("scholarai_api", fromQuery); } catch (e) {}
  }

  window.SCHOLARAI = {
    API_BASE_URL: base.replace(/\/+$/, ""),
    API_PREFIX: "/api/v1",
    get API() { return this.API_BASE_URL + this.API_PREFIX; },
    setBackend(url) {
      try { localStorage.setItem("scholarai_api", url); } catch (e) {}
      this.API_BASE_URL = url.replace(/\/+$/, "");
    },
  };
})();

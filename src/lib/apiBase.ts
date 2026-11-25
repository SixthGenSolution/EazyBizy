/**
 * Base URL of the FastAPI backend (CMA/DPR calculations + PDF generation).
 *
 * Set at build time via VITE_CMA_API_URL (preferred) or VITE_API_URL, e.g.
 *   VITE_CMA_API_URL=https://eazybizy-api.onrender.com
 *
 * In local development it falls back to http://localhost:8000 (`npm run api`).
 * A production build never falls back to localhost: a visitor's browser has
 * no API on its own machine, so that would only produce "Failed to fetch".
 */
const env = import.meta.env;

const configured = String(env.VITE_CMA_API_URL || env.VITE_API_URL || "").trim();

export const API_BASE_URL: string = (configured || (env.DEV ? "http://localhost:8000" : ""))
  .replace(/\/+$/, "");

/** True when a backend URL is available for this build. */
export const isApiConfigured = API_BASE_URL !== "";

/** Production-only: true when the build was made without a backend URL. */
export const isApiMissingInProduction = !env.DEV && !isApiConfigured;

/**
 * Render's free plan sleeps idle services; the first request after a sleep can
 * take ~60 s to wake the container, so report generation gets a long timeout.
 */
export const REPORT_REQUEST_TIMEOUT_MS = 120_000;

export const API_NOT_CONFIGURED_MESSAGE =
  "Report service is not configured for this deployment (VITE_CMA_API_URL is missing).";

// Shared constants for the agentic pipeline background service worker.

export const CAPTURE_MAX_RETRIES = 6;
export const CAPTURE_BASE_DELAY_MS = 900;
export const CAPTURE_MAX_SLICES = 50;
export const CAPTURE_SETTLE_DELAY_MS = 350;
export const CAPTURE_SLICE_OVERLAP_PX = 200;
export const OFFSCREEN_DEFAULT_TIMEOUT_MS = 120000;
export const GEMINI_TIMEOUT_MS = 60000;
export const VLM_TIMEOUT_MS = 120000;
export const PIPELINE_LOG_MAX_ENTRIES = 100;
export const PIPELINE_LOG_MAX_SIZE_BYTES = 2 * 1024 * 1024;
export const AGENTIC_MAX_ATTEMPTS = 3;
export const AGENTIC_SCORE_THRESHOLD = 3.5;

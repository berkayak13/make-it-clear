const PIPELINE_LOG_KEY = 'pipelineLogs';
const PIPELINE_LOG_MAX_ENTRIES = 100;
const PIPELINE_LOG_MAX_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * Sanitize a log entry by truncating large fields and removing image data.
 */
export function sanitizeLogEntry(entry) {
  const clone = { ...entry };
  if (clone.content && clone.content.length > 8000) {
    clone.content = clone.content.slice(0, 8000) + '...';
  }
  if (clone.detail && typeof clone.detail === 'string' && clone.detail.length > 8000) {
    clone.detail = clone.detail.slice(0, 8000) + '...';
  }
  if (clone.input?.images) {
    clone.input = { ...clone.input, imageCount: clone.input.images.length };
    delete clone.input.images;
  }
  return clone;
}

/**
 * Append a log entry to the pipeline logs in chrome.storage.local.
 * Each entry should have: {runId, stage, timestampIso, url, success, detail, durationMs}
 */
export async function appendPipelineLog(entry) {
  let { pipelineLogs = [] } = await chrome.storage.local.get([PIPELINE_LOG_KEY]);

  // Clean old logs that might have images (migration cleanup)
  pipelineLogs = pipelineLogs.map(log => {
    if (log.input?.images) {
      const cleaned = { ...log, input: { ...log.input, imageCount: log.input.images.length } };
      delete cleaned.input.images;
      return cleaned;
    }
    return log;
  });

  const enriched = { starred: false, ...entry };
  const cleaned = sanitizeLogEntry(enriched);

  const next = [cleaned, ...pipelineLogs].slice(0, PIPELINE_LOG_MAX_ENTRIES);
  const nextSize = JSON.stringify(next).length;

  // If too large (> 2MB), aggressively trim
  let toStore = next;
  if (nextSize > PIPELINE_LOG_MAX_SIZE_BYTES) {
    toStore = next.slice(0, 20);
  }

  await chrome.storage.local.set({ [PIPELINE_LOG_KEY]: toStore });
}

/**
 * Get all pipeline logs from storage.
 */
export async function getPipelineLogs() {
  const { pipelineLogs = [] } = await chrome.storage.local.get([PIPELINE_LOG_KEY]);
  return { success: true, logs: pipelineLogs };
}

/**
 * Clear all pipeline logs.
 */
export async function clearPipelineLogs() {
  await chrome.storage.local.set({ [PIPELINE_LOG_KEY]: [] });
  return { success: true };
}

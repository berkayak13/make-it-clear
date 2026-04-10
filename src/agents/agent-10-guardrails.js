export const name = 'guardrails';
export const phase = 5;
export const optional = false;
export const requiredFields = ['renarrations'];

function sanitizeHtml(text) {
  return text
    // Remove dangerous tags including SVG
    .replace(/<\/?(?:script|iframe|object|embed|form|input|button|svg|math|animate|set)\b[^>]*>/gi, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
    // Remove event handlers (whitespace-tolerant)
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\bon\w+\s*=\s*[^\s>]*/gi, '')
    // Remove javascript:/vbscript: URIs (plain and whitespace-obfuscated)
    .replace(/\bjavascript\s*:/gi, '')
    .replace(/\bvbscript\s*:/gi, '')
    // Entity-encoded javascript: variants (e.g. &#106;avascript:)
    .replace(/(?:j|&#(?:106|x6a);?)(?:a|&#(?:97|x61);?)(?:v|&#(?:118|x76);?)(?:a|&#(?:97|x61);?)(?:s|&#(?:115|x73);?)(?:c|&#(?:99|x63);?)(?:r|&#(?:114|x72);?)(?:i|&#(?:105|x69);?)(?:p|&#(?:112|x70);?)(?:t|&#(?:116|x74);?)\s*:/gi, '')
    .replace(/data\s*:\s*text\/html/gi, '')
    // Remove CSS expression injection
    .replace(/expression\s*\(/gi, '')
    .replace(/url\s*\(\s*["']?\s*javascript/gi, '');
}

/** Sanitizes renarrated text in-place and returns flags for any stripped XSS content. */
function runXssSanitization(renarrations) {
  const flags = [];

  for (const section of renarrations) {
    const original = section.text || '';
    const sanitized = sanitizeHtml(original);

    if (sanitized !== original) {
      flags.push({
        sectionId: section.sectionId,
        type: 'xss',
        severity: 'error',
        detail: 'Potentially dangerous HTML content was detected and removed',
        suggestion: 'Review the source content for embedded scripts or unsafe markup'
      });
      section.text = sanitized;
    }
  }

  return flags;
}

export async function run(context) {
  const startTime = Date.now();
  const renarrations = context.renarrations || [];

  // XSS sanitization only — fast, synchronous, in-place
  const xssFlags = runXssSanitization(renarrations);
  const hasErrors = xssFlags.some(flag => flag.severity === 'error');

  context.guardrails = { passed: !hasErrors, flags: xssFlags };

  context.log = context.log || [];
  context.log.push({
    agent: name,
    phase,
    durationMs: Date.now() - startTime,
    success: true,
    detail: `${xssFlags.length} XSS flags, passed=${!hasErrors}`,
    flagCount: xssFlags.length,
    passed: !hasErrors
  });

  return context;
}

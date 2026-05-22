# Security notes

This document records the extension's known security posture and the rationale
behind security-relevant design decisions. It is the documentation deliverable
for audit issues #7, #8, and #9.

## OpenAI API key exposure (issue #7)

**Status: known limitation — mitigated by key rotation, not yet eliminated.**

The OpenAI API key is supplied at build time via `VITE_OPENAI_API_KEY` and is
inlined by Vite into `build/background-entry.js`. Anything bundled into a browser
extension is extractable from the shipped/unpacked extension — there is no way to
keep a build-time secret confidential in a purely client-side extension.

Mitigations in place:

- The leaked development key **must be rotated** (revoke the old key in the
  OpenAI dashboard and issue a new one). See `openspec/changes/fix-audit-findings`
  task 6.1 — this is an operational action for the project owner.
- `.env` is gitignored, so the key is not committed to version control.
- Apply usage limits / budget caps to the OpenAI key.

Not yet done (tracked as a follow-up): moving LLM calls behind a server-side
proxy, or having each user supply their own key via the options page, so no
usable credential ships in the bundle. The `secret-management` capability spec
in `openspec/changes/fix-audit-findings/specs/` describes the target state; its
runtime-credential requirement remains open for a future change.

## Host permissions (issue #8)

The manifest requests `<all_urls>` in two places. Both are required:

- **`content_scripts[].matches: <all_urls>`** — the reading overlay is an
  on-page feature meant to work on any article the user visits, so the content
  script is injected on all pages. (`activeTab` + on-demand `chrome.scripting`
  injection was considered; it was not adopted because it would change the
  overlay from always-available to click-to-inject.)
- **`host_permissions: <all_urls>`** — the background service worker fetches
  images from arbitrary third-party CDNs to embed them as data URIs in the
  generated static site (`src/page-flow/build-static-site.js`,
  `collectImageDataURIs`). `activeTab` only grants access to the active tab's
  own origin, so it cannot replace this; narrowing it would break static-site
  image embedding.

This justification satisfies the `extension-permissions` spec, which permits
retaining `<all_urls>` when the rationale is documented.

## Content-script security posture (issue #9)

- The injected overlay (`clear-overlay.js`) renders inside a **shadow DOM**,
  isolating its markup and styles from the host page.
- Every `innerHTML` sink in `content.js` and `clear-overlay.js` was audited:
  each receives either static markup (icons, fixed UI strings) or dynamic
  values escaped through `escapeHtml()` / `esc()` before interpolation. Final
  renarrated text is rendered with `textContent`. No unescaped untrusted-input
  sink was found.
- Manifest V3 has no manifest-level CSP knob for content scripts (the
  `content_security_policy.extension_pages` policy applies only to extension
  pages such as the popup, options, and viewers). Content-script safety is
  therefore enforced in code via the escaping and shadow-DOM isolation above.

## Reporting

For anything not covered here, open a GitHub issue on the repository.

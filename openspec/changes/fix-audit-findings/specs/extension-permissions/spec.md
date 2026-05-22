## ADDED Requirements

### Requirement: Host permissions are scoped or justified

The manifest SHALL request the narrowest host access that supports the feature set. If `<all_urls>` access is retained, the justification MUST be documented in the repository (README or a privacy note).

#### Scenario: Permission scope is reviewed

- **WHEN** `manifest.json` is reviewed after this change
- **THEN** `host_permissions` and `content_scripts[].matches` MUST either be narrowed to specific patterns or be accompanied by a documented justification

#### Scenario: On-demand injection considered

- **WHEN** broad standing access is not required for passive behavior
- **THEN** the extension SHOULD use `activeTab` plus the `scripting` API for user-triggered injection instead of a standing `<all_urls>` content script

### Requirement: Injected content is constructed safely

Content scripts SHALL construct injected DOM without trusting page-controlled input, and the content-security posture for injected scripts MUST be reviewed.

#### Scenario: No unsafe HTML sinks with untrusted input

- **WHEN** `content.js` and `clear-overlay.js` write dynamic content into the DOM
- **THEN** every `innerHTML` sink MUST either receive only escaped/static content or be replaced with `textContent` / DOM-builder APIs

#### Scenario: CSP posture documented

- **WHEN** this change is applied
- **THEN** the content-script CSP posture MUST be documented and tightened where the manifest allows

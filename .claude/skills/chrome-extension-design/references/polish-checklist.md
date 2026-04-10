# The Polish Checklist

Read this before shipping, or when the user says "it works but feels off." These are the small things that separate a professional-feeling extension from an amateur one. Go through the list; fix what applies.

## Empty states

An extension with no data should never show a blank rectangle. Every list, table, and panel needs a designed empty state.

- **Short headline**: "No saved items yet" — not "No data" (too cold) or "You don't have any items to display at this time" (too long).
- **One-line explanation**: tell the user how to get out of the empty state. "Click the + button to add your first bookmark."
- **Optional visual**: a single muted icon centered above the text. Keep it subtle.
- **No empty state for states that should never be empty.** If the popup requires setup before working, show an onboarding screen, not an empty state.

## Loading states

- **<200ms operations**: no loading indicator. Showing a spinner that flashes for 80ms is worse than nothing.
- **200ms–1s operations**: a subtle inline indicator (skeleton, pulsing placeholder, or a small spinner next to the triggering button).
- **>1s operations**: full skeleton or progress indicator with a status message.
- **Never block the entire popup** on a network request. The user can re-open the popup; they can't un-see a frozen UI.

Skeleton pattern:

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-subtle) 0%,
    var(--bg-hover) 50%,
    var(--bg-subtle) 100%
  );
  background-size: 200% 100%;
  animation: skeleton 1.4s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
@keyframes skeleton {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

## Error states

- **Never show raw error messages** like `TypeError: Cannot read property 'x' of undefined`. Catch and replace with human text.
- **Tell the user what to do next.** "Couldn't reach the server. Check your connection and try again." Plus a retry button.
- **Inline errors for form validation** (under the field in --danger color), not browser `alert()`.

## Micro-interactions

These are the small animations and transitions that make a UI feel alive. Rules:

- **Duration**: 120ms for hover/focus/press, 200ms for appearance/dismissal. Never longer.
- **Easing**: `cubic-bezier(0.2, 0, 0, 1)` (roughly "ease-out") for incoming motion. It feels snappy and natural.
- **Only animate cheap properties**: `transform`, `opacity`. Avoid animating `width`, `height`, `top`, `left` — they trigger layout.
- **Respect `prefers-reduced-motion`**:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```

Good places to add micro-interactions:
- Button press (subtle `transform: translateY(1px)` on `:active`)
- Hover backgrounds fading in
- New list items sliding/fading in
- Dismissed items fading out
- Toast notifications sliding up from the bottom

## Keyboard support

Users who use extensions often use keyboards a lot. At minimum:

- **Tab order** is logical (top to bottom, left to right).
- **`:focus-visible` outlines** are styled, not removed. Use `outline: 2px solid var(--accent); outline-offset: 2px;` — never `outline: none` without a replacement.
- **Escape closes modals/overlays.**
- **Enter submits the primary action** in the popup when a text field is focused.
- **Arrow keys navigate lists** if the list is a primary interaction.

## Accessibility basics

- **Every icon-only button has `aria-label`.** A `<button>×</button>` is a mystery to a screen reader.
- **Form controls have real `<label>` elements** (or `aria-label` / `aria-labelledby`).
- **Color contrast** ratio ≥ 4.5:1 for body text, ≥ 3:1 for large text. The default token set in `popup-ui.md` passes this; don't dilute the text colors.
- **Don't use color alone** to convey state. A red border on an invalid input is fine; a red field with no other indication is not.
- **Semantic HTML**: `<button>` for buttons, `<a>` for links, `<nav>` for navigation. Don't `<div onclick>` everything.

## Copy

- **Be specific.** "Save" is better than "Submit". "Delete 3 items" is better than "Delete".
- **Sentence case**, not Title Case. "Save changes" not "Save Changes". Looks less corporate.
- **No exclamation points.** "Saved!" is jarring in a utility. "Saved" is enough.
- **Short error messages.** "Couldn't save" beats "An error occurred while attempting to save your changes".
- **No jargon the user doesn't use.** "API key" is fine for a developer tool, not for a consumer extension.

## Dark mode final check

- [ ] All colors reference tokens, no hardcoded hex values in component CSS
- [ ] Shadows are visible against dark backgrounds (they usually need higher opacity in dark mode)
- [ ] Icons are visible in both modes (dark logo on dark bg = invisible)
- [ ] Images/screenshots don't have baked-in white backgrounds
- [ ] Focus rings are visible on both backgrounds

## The "open it fresh" test

Close the popup. Open it. Does the first thing you see make sense? Is there a clear primary action? Could a brand-new user figure out what to do in 5 seconds? If not, the information hierarchy is wrong — the most important thing isn't visually dominant enough.

## Before shipping

- [ ] Tested at the extension's target popup width — no horizontal scroll
- [ ] Tested with an empty state
- [ ] Tested with a very long list (does scrolling work?)
- [ ] Tested with a very long piece of text in every field (does it wrap or truncate gracefully?)
- [ ] Tested in light and dark mode
- [ ] Tested keyboard navigation all the way through
- [ ] Icons generated at all 4 sizes from a clean source
- [ ] Console is clean — no errors, no leftover `console.log`s
- [ ] Permissions in manifest.json are minimal
- [ ] Description in manifest.json is a real sentence, not "TODO"
- [ ] Version number is set
- [ ] Tested with `chrome://extensions` in developer mode on a fresh load

If all of these pass, the extension is ready to ship — or at least ready to look good in a demo.

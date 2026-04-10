# Icons and Assets

The toolbar icon is the extension's storefront. It's the first and most-seen element of the UI. Read this when generating icons or when the user's current icons look blurry/stretched/generic.

## The sizes Chrome actually needs

```
icons/
├── icon-16.png    — favicon / context menu
├── icon-32.png    — Windows HiDPI / some toolbar contexts
├── icon-48.png    — extensions management page
└── icon-128.png   — Chrome Web Store listing
```

All four. Don't skip any. Chrome will upscale missing sizes and it always looks bad.

Declare them in manifest.json in two places:

```json
{
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png"
    }
  }
}
```

The top-level `"icons"` is used by the Chrome Web Store and the extensions page. The `"action.default_icon"` is what shows in the toolbar.

## Design principles for a 16x16 icon

This is the hardest size. Most design failures happen here.

1. **Start from a vector.** Design in SVG or Figma at 128x128 or larger, then export to PNG at each size. Never design at 16x16 directly; never upscale from a small raster.
2. **One shape, one color, optional accent.** At 16 pixels, detail vanishes. A single bold silhouette reads; a detailed illustration becomes mush.
3. **Maximize contrast with the toolbar.** Chrome's toolbar is near-white in light mode and near-black in dark mode. A mid-gray icon disappears in both. Use a saturated color or pure black/white.
4. **Fill the frame.** Leave ~1–2px of padding on the 16x16, no more. Tiny icons floating in whitespace look lost next to Chrome's built-in buttons.
5. **Pixel-snap when possible.** For 16x16 specifically, align major edges to the pixel grid in the source SVG. Anti-aliased blurry edges are the #1 cause of "why does it look fuzzy."
6. **Test on both light and dark toolbars.** Chrome doesn't auto-invert extension icons. If the brand is black, it'll disappear in dark mode. Consider a version with an outline or a rounded-square background.

## Generating icons from a source SVG

If the user has an SVG, generate the PNGs with ImageMagick or a quick Node script:

```bash
# ImageMagick
for size in 16 32 48 128; do
  magick -background none -density 384 source.svg \
    -resize ${size}x${size} icons/icon-${size}.png
done
```

Or with `sharp` in Node:

```js
import sharp from 'sharp';
for (const size of [16, 32, 48, 128]) {
  await sharp('source.svg')
    .resize(size, size)
    .png()
    .toFile(`icons/icon-${size}.png`);
}
```

The `-density 384` on ImageMagick (or the equivalent in other tools) renders the SVG at high resolution before downsampling, which preserves sharpness.

## What to do if the user has no icon yet

1. **Ask what the extension does in one word.** That's the icon.
2. **Sketch three concepts** as simple silhouettes: a literal metaphor, an abstract mark, and a letterform.
3. **Pick the one that still reads at 16x16.** If you're squinting, it's wrong.

If the user is building a throwaway prototype and just wants something non-embarrassing, a colored rounded square with a single letter (the first letter of the extension name) in white is a perfectly fine placeholder. Not inspired, but professional.

```svg
<!-- 128x128 placeholder: rounded square + letter -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#3b5bdb"/>
  <text x="64" y="64" text-anchor="middle" dominant-baseline="central"
        font-family="-apple-system, Helvetica, Arial, sans-serif"
        font-size="72" font-weight="700" fill="white">E</text>
</svg>
```

Replace the color and letter. Export to the four sizes above.

## Badge text (the little number on the icon)

If the extension shows a count on its toolbar icon (unread items, etc.), use the action API:

```js
chrome.action.setBadgeText({ text: '3' });
chrome.action.setBadgeBackgroundColor({ color: '#3b5bdb' });
chrome.action.setBadgeTextColor({ color: '#ffffff' }); // Chrome 110+
```

Keep badge text to 1–4 characters. Anything longer gets truncated.

## Other assets

- **Screenshots for the Chrome Web Store**: 1280x800 or 640x400. You need at least one; up to five. Show the popup in context, not alone on a white background.
- **Store promo tile**: 440x280. Optional but helps the listing stand out.
- **Fonts**: If you insist on a custom font (not recommended, see popup-ui.md), ship it as a WOFF2 in the extension and reference it in CSS with `@font-face` and `chrome.runtime.getURL`. Don't load from Google Fonts — MV3 forbids remote code and strict CSP blocks it anyway.

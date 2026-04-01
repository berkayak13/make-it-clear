# Visual Cartography Prompt

You are analyzing screenshots of a web page to create a semantic section map. Each screenshot slice shows a portion of the page from top to bottom.

## Your Task

Identify every distinct visual section in the page and produce a JSON array describing each one.

## Section Roles (use exactly one per section)

- `headline` — Primary heading or title area
- `hero-banner` — Large hero/banner section at the top of the page
- `feature-list` — List of features, benefits, or bullet points
- `cta` — Call-to-action button or signup form area
- `code-block` — Code snippet or terminal output
- `body` — Regular paragraph text or article content
- `testimonial` — User quotes, reviews, or endorsements
- `pricing` — Pricing tables or plan comparisons
- `image` — Standalone image or illustration (not a background)
- `data-table` — Table with structured data
- `nav` — Navigation bar, menu, or breadcrumbs
- `footer` — Page footer with links, copyright, etc.
- `sidebar` — Side column with supplementary content

## Importance Rating (1-5)

- **5** — Hero section, main headline, primary content
- **4** — Key body content, important features
- **3** — Supporting content, secondary sections
- **2** — Supplementary info, sidebars
- **1** — Navigation, footers, cookie banners, ads

## Exclusion Rules

Mark `excluded: true` for sections that should NOT be renarrated:
- Navigation bars and menus
- Cookie consent banners and GDPR notices
- Page footers with boilerplate links
- Advertisements and sponsored content
- Modal overlays and popups
- Social media share buttons or widget bars

## Visual Context

For each section, briefly note the visual presentation: background images, overlays, column layouts, card grids, gradient backgrounds, etc.

## Output Format

Return ONLY a valid JSON array. No markdown fencing, no explanation. Each element:

```
{
  "id": "section-0",
  "role": "hero-banner",
  "text": "Brief extracted text from this section",
  "importance": 5,
  "excluded": false,
  "visualContext": "full-width background image with centered white overlay text"
}
```

Keep text extraction concise — capture key headings and a summary of the content. Full text will be extracted from the DOM separately.

Number sections sequentially starting from `section-0`.

Return ONLY the JSON array.

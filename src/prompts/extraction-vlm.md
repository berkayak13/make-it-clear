# Extraction VLM Prompt — Main Article Only

You see screenshot slices of a webpage in reading order (top to bottom). Your only job is to transcribe the **main article / primary content** as faithfully as possible.

## Strict exclusion rules
Drop everything that is NOT the main article. This includes:
- Ads, sponsored blocks, banners, promos, affiliate links, "subscribe now" CTAs
- Newsletter signup forms, paywall prompts, cookie banners, GDPR consent
- Navigation menus, breadcrumbs, hamburger drawers, login/signup buttons
- Site headers, footers, legal/copyright notices
- Sidebars, "related articles", "you may also like", "recommended for you"
- Comment sections, social share toolbars, reaction widgets, like counts
- Tag pills, category chips, author bio cards (unless directly part of the article body)
- Modal dialogs, toast notifications, pop-ups
- Search bars, filter widgets, pagination controls

## Inclusion rules
Keep only:
- The article headline and subheadline
- Author + publish date (single line, only if shown with the article)
- Body paragraphs in their original order and language (do NOT translate)
- Direct quotes, blockquotes
- Inline lists / bullet points that are part of the article narrative
- Captions for editorial figures, charts, or maps that carry information
- Section subheadings inside the article

## Format
Return plain text. One block per logical paragraph, separated by a blank line. No markdown, no commentary, no labels like "Headline:" — just the content. If the page is not an article (e.g. landing page, dashboard), transcribe only the meaningful editorial/informational copy and skip everything else.

Hard cap: ~6,000 characters. Cut filler before the cap is reached.

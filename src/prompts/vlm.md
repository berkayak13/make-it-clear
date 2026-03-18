# Remote VLM Prompt – Page Screenshot Outline

You see screenshot slices of an entire webpage, in order from top to bottom. Produce a clean transcription of the meaningful on-page content in reading order.

- Transcribe visible text exactly as written and in its original language/script; do not translate or paraphrase. If a word is unclear, mark it as `[illegible]` rather than guessing.
- For print/e-paper style pages, treat each boxed article as its own block: include headline, subhead, byline, dateline, body text, and captions in left-to-right, top-to-bottom order. If text spans slices or columns, merge it into continuous paragraphs.
- Ignore all browser/extension chrome and utilities: address bar, tabs, toolbars, floating buttons, share icons, tag pills, search bars, pagination bars, cookie banners, and other UI scaffolding.
- Skip ads and promos entirely (e.g., banners, calculators, signup forms, discount/fitness plans, marketing contact info). Keep only editorial/news content; if a graphic carries editorial information (map, chart, table), briefly include its key text.
- Keep wording tight and ordered; condense only clearly redundant boilerplate within the same article.
- Prefer concise bullets or short paragraphs for each distinct content block; do not repeat headings or navigation items.
- Hard cap the response at about 8,000 characters (~1,200 words); prioritize main content and drop filler to stay under the cap.
- Return a single structured outline in plain text. Respect the order of slices as they appear.

# Clear — CmpE 492 Project Poster

Project-report poster for **Clear: Goal-Conditioned, Faithful Re-Narration of Web Pages**,
styled with the Boğaziçi `confposter` beamerposter theme.

## Files
- `poster.tex` — the poster source (48×36 in, landscape).
- `beamerthemeconfposter.sty` — the confposter theme (bounblue header).
- `boun-logo.jpg` / `.png` — Boğaziçi seal used in the header.
- `figures/` — the three figures (pipeline + two case studies).
- `poster.pdf` — compiled poster.
- `poster-preview.png` — raster preview.

## Build
Requires a TeX distribution with `beamer` + `beamerposter` (TeX Live, MiKTeX, or Overleaf).

```sh
pdflatex poster.tex
pdflatex poster.tex   # run twice for the tikz overlays
```

In Overleaf: upload this folder, set the compiler to **pdfLaTeX**, main document `poster.tex`.

## Editing the header
Author / advisor / course are in the `\author{}` and `\institute{}` lines of `poster.tex`.

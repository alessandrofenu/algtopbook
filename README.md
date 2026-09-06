# A Guided Course in Algebraic Topology — mobile reader

A phone-first HTML edition of `../main.pdf`, generated from the LaTeX sources in
`../main.tex`, `../preamble.tex` and `../chapters/`.

Open **`index.html`** in any browser. No server, no network: the mathematics is
pre-rendered and the fonts are bundled.

## Layout

```
index.html                 title page + full table of contents (entry point)
how-to-use-this-book.html  front-matter chapter
c01.html … c31.html        the thirty-one numbered chapters
references.html            the back-matter bibliography
assets/style.css           the whole design
assets/reader.js           drawer, progress bar, scroll affordances, day/night
assets/katex.min.css       KaTeX 0.16.22 stylesheet (woff2 sources only)
assets/fonts/              the 20 KaTeX woff2 faces
build/                     the converter that produced the pages
```

One page per chapter: the largest is under 500 KB and parses in about a second
on a throttled phone, whereas the whole book in one file would be 7 MB.

## How it was built

```
KATEX_PATH=/path/to/node_modules/katex/dist/katex.js node build/build.mjs
```

* `build/latex.mjs` — a deliberately narrow reader for the LaTeX subset this
  book actually uses: `\chapter`/`\section`/`\paragraph`, the ten shared-counter
  theorem environments of `preamble.tex`, `proof`, `hint`/`hints`/`solution`,
  `itemize`/`enumerate`, `equation`, `\[…\]`, `tikzcd`. Anything it does not
  recognise aborts the build rather than being dropped silently.
* `build/render.mjs` — blocks and inline text to HTML; KaTeX for mathematics;
  a `cleveref` emulation (sorting, plural names, three-or-more ranges) for
  `\cref`/`\Cref`; a CSS-grid renderer for `tikz-cd` diagrams.
* `build/build.mjs` — chapter ordering from `main.tex`, all counters, the label
  table, and the page templates.

Numbering is not copied from the `.aux` files; it is recomputed from the sources
and then *checked* against them. All 516 labels LaTeX recorded carry the same
number and the same cross-reference type here.

## Notes on fidelity

* `\purpose{…}` is not printed, matching `\purposevisiblefalse` in
  `preamble.tex` and `main.pdf`.
* Solutions are printed, matching `\showsolutionstrue`.
* `main.toc` predates the last build of `main.pdf` and is missing the References
  chapter; the reader follows the PDF, which lists it.
* The contents also list the four unnumbered sections of the References chapter,
  which `\section*` keeps out of the printed table of contents. This is
  navigation only; no text differs.
* "How to use this book" is a heading with no body in `main.pdf`. The page says
  so in an editor's note rather than leaving a blank screen.

`build/labels.json` is written by the build: every label with the number, page
and anchor it resolved to. It is what the numbering was checked against.

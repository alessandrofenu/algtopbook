#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build.mjs — turn book/main.tex into the mobile reader in book/html_reader/.
//
//   KATEX_PATH=/path/to/node_modules/katex/katex.js node build.mjs
//
// Nothing outside html_reader/ is written to.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments, parseBlocks, readGroup, readOptional, THM_ENVS } from "./latex.mjs";
import { inline, math, renderCD, crefHtml, esc, THM_NAME, THM_STYLE } from "./render.mjs";

const katex = (await import(process.env.KATEX_PATH || "katex")).default;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..");
const BOOK = path.resolve(OUT, "..");

// ===========================================================================
// 1. read main.tex: the order of parts and chapters
// ===========================================================================
const mainSrc = stripComments(fs.readFileSync(path.join(BOOK, "main.tex"), "utf8"));
const spine = [];   // {t:'part'|'chapter'|'matter', ...}
{
  const re = /\\(frontmatter|mainmatter|backmatter|part|chapter|include)\b/g;
  let m;
  while ((m = re.exec(mainSrc))) {
    const name = m[1];
    let i = m.index + m[0].length;
    if (name === "part") { const g = readGroup(mainSrc, i); spine.push({ t: "part", title: g.body }); re.lastIndex = g.end; }
    else if (name === "include") { const g = readGroup(mainSrc, i); spine.push({ t: "include", file: g.body.trim() }); re.lastIndex = g.end; }
    else if (name === "chapter") {
      const opt = readOptional(mainSrc, i); const g = readGroup(mainSrc, opt.end);
      spine.push({ t: "inlineChapter", title: g.body, short: opt.body });
      re.lastIndex = g.end;
    } else spine.push({ t: "matter", which: name });
  }
}

// ===========================================================================
// 2. parse every chapter into blocks
// ===========================================================================
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const docs = [];            // one entry per output page
let matter = "front", partNo = 0, chapNo = 0, curPart = null;

for (const s of spine) {
  if (s.t === "matter") { matter = s.which.replace("matter", ""); continue; }
  if (s.t === "part") {
    partNo++;
    curPart = { num: ROMAN[partNo], title: s.title, chapters: [] };
    docs.push({ kind: "part", part: curPart });
    continue;
  }
  let nodes, srcFile;
  if (s.t === "inlineChapter") {
    nodes = [{ k: "chapter", title: s.title, short: s.short, starred: false }];
    srcFile = "main.tex";
  } else {
    srcFile = s.file + ".tex";
    const raw = fs.readFileSync(path.join(BOOK, srcFile), "utf8");
    nodes = parseBlocks(stripComments(raw));
  }
  const head = nodes.find((n) => n.k === "chapter");
  if (!head) throw new Error("no \\chapter in " + srcFile);
  const numbered = matter === "main";
  if (numbered) chapNo++;
  const slug = numbered
    ? "c" + String(chapNo).padStart(2, "0")
    : slugify(head.short || head.title);
  const doc = {
    kind: "chapter", srcFile, nodes,
    num: numbered ? String(chapNo) : null,
    title: head.title, short: head.short || head.title,
    file: slug + ".html", part: curPart, sections: [],
  };
  docs.push(doc);
  if (curPart) curPart.chapters.push(doc);
}

function slugify(s) {
  return s.toLowerCase().replace(/\$[^$]*\$/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ===========================================================================
// 3. numbering pass — assign every counter and record every \label
// ===========================================================================
const labels = new Map();
let ord = 0;
const anchors = new Set();

function anchorFor(name) {
  let a = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let base = a, k = 2;
  while (anchors.has(a)) a = base + "-" + k++;
  anchors.add(a);
  return a;
}

for (const doc of docs) {
  if (doc.kind !== "chapter") continue;
  let secNo = 0, thmNo = 0, eqNo = 0;
  let target = null;

  const bind = (name) => {
    if (!target) throw new Error("\\label{" + name + "} with no target in " + doc.srcFile);
    if (labels.has(name)) throw new Error("duplicate label " + name);
    target.anchor = target.anchor || anchorFor(name);
    labels.set(name, {
      kind: target.kind, num: target.num, file: doc.file,
      anchor: target.anchor, ord: target.ord, chap: doc.num, n: target.n,
    });
  };

  const walk = (nodes) => {
    for (const nd of nodes) {
      switch (nd.k) {
        case "chapter":
          nd.ord = ++ord; nd.anchor = "top";
          target = { kind: "chapter", num: doc.num, ord: nd.ord, anchor: "top", n: doc.num ? Number(doc.num) : null };
          nd.numText = doc.num;
          break;
        case "section":
        case "subsection":
          nd.ord = ++ord;
          if (!nd.starred && doc.num) { secNo++; nd.numText = `${doc.num}.${secNo}`; }
          else nd.numText = null;
          nd.anchor = anchorFor(nd.numText ? "sec-" + nd.numText : "sec-" + slugify(nd.title));
          target = { kind: "section", num: nd.numText, ord: nd.ord, anchor: nd.anchor, n: nd.numText ? secNo : null };
          if (nd.k === "section") doc.sections.push(nd);
          break;
        case "thm": {
          thmNo++;
          nd.ord = ++ord;
          nd.numText = doc.num ? `${doc.num}.${thmNo}` : String(thmNo);
          nd.anchor = anchorFor(nd.kind + "-" + nd.numText);
          target = { kind: nd.kind, num: nd.numText, ord: nd.ord, anchor: nd.anchor, n: thmNo };
          walk(nd.body);
          break;
        }
        case "equation": {
          const lm = /\\label\{([^}]*)\}/.exec(nd.math);
          eqNo++;
          nd.ord = ++ord;
          nd.numText = doc.num ? `${doc.num}.${eqNo}` : String(eqNo);
          nd.math = nd.math.replace(/\\label\{[^}]*\}/g, "");
          nd.anchor = anchorFor("eq-" + nd.numText);
          const prev = target;
          target = { kind: "equation", num: nd.numText, ord: nd.ord, anchor: nd.anchor, n: eqNo };
          if (lm) bind(lm[1].trim());
          target = prev;
          break;
        }
        case "label": bind(nd.name); break;
        case "proof": case "aside": walk(nd.body); break;
        case "list": for (const it of nd.items) walk(it.body); break;
        default: break;
      }
    }
  };
  walk(doc.nodes);
}

// ===========================================================================
// 4. render
// ===========================================================================
const errors = [];
const ctxFor = (file) => ({ katex, labels, file, errors });

function renderNodes(nodes, ctx, opts = {}) {
  const out = [];
  let pendingHead = null;          // a \paragraph waiting for its first line
  const take = () => { const h = pendingHead; pendingHead = null; return h || ""; };
  for (const nd of nodes) {
    if (pendingHead && nd.k !== "para") { out.push(`<p class="runin">${take()}</p>`); }
    switch (nd.k) {
      case "chapter": break;   // emitted by the page template
      case "section": {
        const num = nd.numText ? `<span class="secno">${nd.numText}</span> ` : "";
        out.push(`<h2 id="${nd.anchor}">${num}${inline(nd.title, ctx)}</h2>`);
        break;
      }
      case "subsection": {
        const num = nd.numText ? `<span class="secno">${nd.numText}</span> ` : "";
        out.push(`<h3 id="${nd.anchor}">${num}${inline(nd.title, ctx)}</h3>`);
        break;
      }
      case "paragraph":
        pendingHead = `<span class="runin-head">${inline(nd.title, ctx)}</span> `;
        break;
      case "para":
        out.push(`<p${nd.cont ? ' class="cont"' : ""}>${take()}${inline(nd.text, ctx)}</p>`);
        break;
      case "display":
        out.push(`<div class="dispwrap">${math(ctx, nd.math, true)}</div>`);
        break;
      case "equation":
        out.push(
          `<div class="eqn" id="${nd.anchor}">` +
          `<div class="dispwrap">${math(ctx, nd.math, true)}</div>` +
          `<span class="eqno">(${nd.numText})</span></div>`);
        break;
      case "cd":
        out.push(renderCD(nd.src, ctx));
        break;
      case "list": {
        const tag = nd.ordered ? "ol" : "ul";
        const cls = nd.ordered ? ` class="${listClass(nd.opt)}"` : "";
        out.push(`<${tag}${cls}>` +
          nd.items.map((it) => `<li>${renderNodes(it.body, ctx)}</li>`).join("") +
          `</${tag}>`);
        break;
      }
      case "thm": {
        const name = THM_NAME[nd.kind];
        const style = THM_STYLE[nd.kind];
        const note = nd.opt ? ` <span class="thm-note">(${inline(nd.opt, ctx)})</span>` : "";
        const head = `<span class="thm-head"><span class="thm-name">${name} ${nd.numText}</span>${note}.</span> `;
        out.push(
          `<section class="thm thm-${style} kind-${nd.kind}" id="${nd.anchor}">` +
          runIn(head, renderNodes(nd.body, ctx)) + `</section>`);
        break;
      }
      case "proof": {
        const head = `<span class="proof-head">${nd.opt ? inline(nd.opt, ctx) : "Proof"}.</span> `;
        const qed = `<span class="qed" aria-label="end of proof">□</span>`;
        out.push(`<section class="proof">` +
          runOut(qed, runIn(head, renderNodes(nd.body, ctx))) + `</section>`);
        break;
      }
      case "aside": {
        const name = nd.kind === "solution" ? "Solution"
          : nd.kind === "hints" ? "Hints" + (nd.opt ? inline(nd.opt, ctx) : "")
            : "Hint";
        const head = `<span class="aside-head">${name}.</span> `;
        out.push(`<section class="aside aside-${nd.kind === "hints" ? "hint" : nd.kind}">` +
          runIn(head, renderNodes(nd.body, ctx)) + `</section>`);
        break;
      }
      case "label": case "item": break;
      default: throw new Error("unrendered node " + nd.k);
    }
  }
  if (pendingHead) out.push(`<p class="runin">${take()}</p>`);
  return out.join("\n");
}

// amsthm sets its heads run-in with the first paragraph; so do we, which also
// saves a line of vertical space on every statement in the book.
function runIn(head, body) {
  const m = /^\s*<p\b[^>]*>/.exec(body);
  if (m) return body.slice(0, m[0].length) + head + body.slice(m[0].length);
  return `<p class="head-only">${head}</p>` + body;
}
// the QED symbol belongs at the end of the last line of the proof
function runOut(mark, body) {
  const i = body.lastIndexOf("</p>");
  if (i >= 0 && /^\s*$/.test(body.slice(i + 4))) return body.slice(0, i) + mark + body.slice(i);
  return body + `<span class="qed-block" aria-label="end of proof">□</span>`;
}

function listClass(opt) {
  if (!opt) return "";
  if (/\\alph\*/.test(opt)) return "lst-alph";
  if (/\\roman\*/.test(opt)) return "lst-roman";
  if (/\\arabic\*/.test(opt)) return "lst-arabic";
  return "";
}

// ===========================================================================
// 5. page shell
// ===========================================================================
const chapters = docs.filter((d) => d.kind === "chapter");
const pages = [{ file: "index.html", title: "Contents", num: null }, ...chapters];

function tocHtml(current) {
  const out = [`<nav class="toc" aria-label="Table of contents">`];
  out.push(`<a class="toc-title${current === "index.html" ? " here" : ""}" href="index.html">A Guided Course in Algebraic Topology</a>`);
  out.push(`<ol class="toc-list">`);
  let openPart = false;
  for (const d of docs) {
    if (d.kind === "part") {
      if (openPart) out.push(`</ol></li>`);
      out.push(`<li class="toc-part"><span class="part-label">Part ${d.part.num}</span>` +
        `<span class="part-title">${inlineSafe(d.part.title)}</span><ol class="toc-sub">`);
      openPart = true;
      continue;
    }
    const here = d.file === current;
    out.push(`<li class="toc-ch${here ? " here" : ""}">` +
      `<a href="${d.file}"><span class="chno">${d.num || ""}</span>` +
      `<span class="chttl">${inlineSafe(d.short)}</span></a>`);
    if (here && d.sections.length) {
      out.push(`<ol class="toc-secs">` + d.sections.map((s) =>
        `<li><a href="#${s.anchor}">${s.numText ? `<span class="secno">${s.numText}</span> ` : ""}${inlineSafe(s.title)}</a></li>`
      ).join("") + `</ol>`);
    }
    out.push(`</li>`);
  }
  if (openPart) out.push(`</ol></li>`);
  out.push(`</ol></nav>`);
  return out.join("\n");
}

// titles inside navigation still contain mathematics ($\Delta$-complexes)
const navCtx = { katex, labels, file: "nav", errors };
const inlineSafe = (s) => inline(s, navCtx);

function shell({ file, title, heading, body, prev, next, cls = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} · A Guided Course in Algebraic Topology</title>
<link rel="stylesheet" href="assets/katex.min.css">
<link rel="stylesheet" href="assets/style.css">
<script>try{var t=localStorage.getItem("agcat-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
</head>
<body class="${cls}">
<a class="skip" href="#main">Skip to content</a>
<header class="bar">
  <button class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="drawer" aria-label="Contents">
    <span class="burger"></span>
  </button>
  <div class="bar-title">${heading}</div>
  <button class="theme-btn" id="theme-btn" aria-label="Switch between light and dark">◐</button>
  <a class="bar-home" href="index.html" aria-label="Title page and contents">✦</a>
  <div class="progress"><div class="progress-fill" id="progress"></div></div>
</header>
<div class="drawer" id="drawer">
  <div class="drawer-scrim" id="scrim"></div>
  <div class="drawer-panel">${tocHtml(file)}</div>
</div>
<div class="layout">
  <main id="main" class="page">
${body}
${prev || next ? `<nav class="pager">
  ${prev ? `<a class="pager-prev" href="${prev.file}"><span>Previous</span><b>${prev.label}</b></a>` : `<span></span>`}
  ${next ? `<a class="pager-next" href="${next.file}"><span>Next</span><b>${next.label}</b></a>` : `<span></span>`}
</nav>` : ""}
  </main>
</div>
<button class="totop" id="totop" aria-label="Back to top">↑</button>
<script src="assets/reader.js" defer></script>
</body>
</html>
`;
}

const bodyless = (d) => !d.nodes.some((n) => n.k !== "chapter" && n.k !== "label");
const labelOf = (d) => (d.num ? `${d.num}. ` : "") + stripMath(d.short);
const stripMath = (s) => s.replace(/\$([^$]*)\$/g, (_, m) =>
  m.replace(/\\Delta/g, "Δ").replace(/\\[a-zA-Z]+/g, "").replace(/[{}^_]/g, ""));

// ---- chapter pages ---------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
const written = [];

chapters.forEach((doc, idx) => {
  const ctx = ctxFor(doc.file);
  const head = doc.nodes.find((n) => n.k === "chapter");
  const partLine = doc.part
    ? `<p class="ch-part">Part ${doc.part.num} · ${inline(doc.part.title, ctx)}</p>` : "";
  const kicker = doc.num ? `<p class="ch-kicker">Chapter ${doc.num}</p>` : "";
  const body = `<article class="chapter">
<header class="ch-head" id="top">
${partLine}${kicker}
<h1>${inline(head.title, ctx)}</h1>
</header>
${doc.sections.length > 1 ? `<nav class="minitoc" aria-label="In this chapter"><p class="minitoc-h">In this chapter</p><ol>` +
    doc.sections.map((s) => `<li><a href="#${s.anchor}">${s.numText ? `<span class="secno">${s.numText}</span> ` : ""}${inline(s.title, ctx)}</a></li>`).join("") +
    `</ol></nav>` : ""}
${renderNodes(doc.nodes, ctx)}
${bodyless(doc) ? `<p class="editor-note">This chapter is a heading only: it has no text in
<code>main.pdf</code>, and none has been supplied here.</p>` : ""}
</article>`;
  const prev = idx > 0 ? { file: chapters[idx - 1].file, label: labelOf(chapters[idx - 1]) } : { file: "index.html", label: "Contents" };
  const next = idx + 1 < chapters.length ? { file: chapters[idx + 1].file, label: labelOf(chapters[idx + 1]) } : null;
  const html = shell({
    file: doc.file,
    title: (doc.num ? doc.num + ". " : "") + stripMath(doc.short),
    heading: `<span class="bar-num">${doc.num || ""}</span><span class="bar-name">${inline(doc.short, ctx)}</span>`,
    body, prev, next,
  });
  fs.writeFileSync(path.join(OUT, doc.file), html);
  written.push(doc.file);
});

// ---- title page + contents -------------------------------------------------
{
  const ctx = ctxFor("index.html");
  let body = `<article class="frontpage">
<header class="titlepage">
  <p class="tp-kicker">A Guided Course in</p>
  <h1>Algebraic Topology</h1>
  <p class="tp-sub">from surfaces to transferred structures</p>
  <p class="tp-meta">${chapters.filter(c => c.num).length} chapters · five parts · mobile edition</p>
  <p class="tp-go"><a class="cta" href="${chapters[0].file}">Start reading</a></p>
</header>
<h2 id="contents">Contents</h2>
<ol class="bigtoc">`;
  let open = false;
  for (const d of docs) {
    if (d.kind === "part") {
      if (open) body += `</ol></li>`;
      body += `<li class="bt-part"><span class="part-label">Part ${d.part.num}</span><span class="part-title">${inline(d.part.title, ctx)}</span><ol>`;
      open = true;
      continue;
    }
    body += `<li class="bt-ch"><a href="${d.file}">${d.num ? `<span class="chno">${d.num}</span>` : `<span class="chno chno-none"></span>`}<span class="chttl">${inline(d.short, ctx)}</span></a>`;
    if (d.sections.length) {
      body += `<ol class="bt-secs">` + d.sections.map((s) =>
        `<li><a href="${d.file}#${s.anchor}">${s.numText ? `<span class="secno">${s.numText}</span> ` : ""}${inline(s.title, ctx)}</a></li>`).join("") + `</ol>`;
    }
    body += `</li>`;
  }
  if (open) body += `</ol></li>`;
  body += `</ol></article>`;
  fs.writeFileSync(path.join(OUT, "index.html"), shell({
    file: "index.html",
    title: "Contents",
    heading: `<span class="bar-name">A Guided Course in Algebraic Topology</span>`,
    body,
    next: { file: chapters[0].file, label: labelOf(chapters[0]) },
    cls: "is-front",
  }));
  written.push("index.html");
}

// ===========================================================================
// 6. report
// ===========================================================================
if (errors.length) {
  const seen = new Map();
  for (const e of errors) {
    const key = e.msg.split("\n")[0].slice(0, 90) + " :: " + e.src.slice(0, 60);
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  console.error(`\n${errors.length} rendering problem(s):`);
  for (const [k, v] of seen) console.error(`  [${v}] ${k}`);
} else {
  console.log("no rendering problems");
}
console.log(`${written.length} pages, ${labels.size} labels, ${chapters.length} chapters`);
fs.writeFileSync(path.join(HERE, "labels.json"), JSON.stringify([...labels], null, 1));

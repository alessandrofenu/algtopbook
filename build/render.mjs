// ---------------------------------------------------------------------------
// render.mjs — block and inline nodes -> HTML, with KaTeX for the mathematics.
// ---------------------------------------------------------------------------
import { MACROS, normaliseMath, readGroup, readOptional, THM_ENVS } from "./latex.mjs";

export const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// --- printed names ----------------------------------------------------------
export const THM_NAME = {
  theorem: "Theorem", proposition: "Proposition", lemma: "Lemma",
  corollary: "Corollary", definition: "Definition", example: "Example",
  construction: "Construction", exercise: "Exercise",
  remark: "Remark", warning: "Warning",
};
// amsthm styles, as set in preamble.tex
export const THM_STYLE = {
  theorem: "plain", proposition: "plain", lemma: "plain", corollary: "plain",
  definition: "defn", example: "defn", construction: "defn", exercise: "defn",
  remark: "rmk", warning: "rmk",
};
const CREF_NAME = {
  chapter: ["Chapter", "Chapters"],
  section: ["Section", "Sections"],
  equation: ["Equation", "Equations"],
  ...Object.fromEntries(Object.keys(THM_NAME).map((k) => [k, [THM_NAME[k], THM_NAME[k] + "s"]])),
};

// ---------------------------------------------------------------------------
// context: { katex, labels: Map(label -> ref), file, errors: [] }
// ref = { kind, num, file, anchor, ord, chap, n }
// ---------------------------------------------------------------------------

export function math(ctx, src, display) {
  try {
    return ctx.katex.renderToString(normaliseMath(src), {
      displayMode: !!display,
      macros: { ...MACROS },
      throwOnError: true,
      strict: false,
      output: "htmlAndMathml",
    });
  } catch (e) {
    ctx.errors.push({ file: ctx.file, src, msg: e.message });
    return `<span class="math-error">${esc(src)}</span>`;
  }
}

// --- cleveref ---------------------------------------------------------------
function link(ref, text, ctx) {
  const href = (ref.file === ctx.file ? "" : ref.file) + "#" + ref.anchor;
  return `<a class="xref" href="${href}">${text}</a>`;
}

export function crefHtml(labelsCsv, ctx) {
  const names = labelsCsv.split(",").map((s) => s.trim()).filter(Boolean);
  const refs = [];
  for (const n of names) {
    const r = ctx.labels.get(n);
    if (!r) { ctx.errors.push({ file: ctx.file, src: "\\cref{" + n + "}", msg: "undefined label" }); continue; }
    refs.push(r);
  }
  if (!refs.length) return `<span class="math-error">??</span>`;
  refs.sort((a, b) => a.ord - b.ord);

  // group consecutive references of the same kind
  const groups = [];
  for (const r of refs) {
    const g = groups[groups.length - 1];
    if (g && g.kind === r.kind) g.items.push(r);
    else groups.push({ kind: r.kind, items: [r] });
  }

  const parts = groups.map((g) => {
    const [sing, plur] = CREF_NAME[g.kind] || [cap(g.kind), cap(g.kind) + "s"];
    const name = g.items.length > 1 ? plur : sing;
    // compress runs of three or more adjacent numbers into a range
    const chunks = [];
    let run = [g.items[0]];
    for (let i = 1; i < g.items.length; i++) {
      if (adjacent(run[run.length - 1], g.items[i])) run.push(g.items[i]);
      else { chunks.push(run); run = [g.items[i]]; }
    }
    chunks.push(run);
    const rendered = [];
    for (const c of chunks) {
      if (c.length >= 3) rendered.push({ html: null, range: c });
      else for (const r of c) rendered.push({ html: null, one: r });
    }
    // the type name rides on the first reference (cleveref's nameinlink)
    const bits = rendered.map((x, i) => {
      const pre = i === 0 ? name + " " : "";
      if (x.range) {
        const a = x.range[0], b = x.range[x.range.length - 1];
        return link(a, pre + esc(a.num), ctx) + " to " + link(b, esc(b.num), ctx);
      }
      return link(x.one, pre + esc(x.one.num), ctx);
    });
    return joinList(bits, " and ");
  });
  return joinList(parts, ", and ");
}

function adjacent(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.chap !== b.chap) return false;
  return typeof a.n === "number" && b.n === a.n + 1;
}
function joinList(items, lastSep) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + (lastSep === ", and " ? " and " : lastSep) + items[1];
  return items.slice(0, -1).join(", ") + lastSep + items[items.length - 1];
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// --- inline text -> HTML ----------------------------------------------------
const ACCENTS = {
  '"': { a: "ä", o: "ö", u: "ü", A: "Ä", O: "Ö", U: "Ü", e: "ë", i: "ï" },
  "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", c: "ć", E: "É", A: "Á", O: "Ó" },
  "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È" },
  "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û", O: "Ô" },
  "~": { n: "ñ", a: "ã", o: "õ" },
  v: { C: "Č", c: "č", S: "Š", s: "š", z: "ž", Z: "Ž", e: "ě", r: "ř" },
  c: { c: "ç", C: "Ç", s: "ş" },
  ".": { z: "ż", Z: "Ż" },
  u: { a: "ă", g: "ğ" },
  k: { a: "ą", e: "ę" },
  H: { o: "ő", u: "ű" },
};

const SIMPLE = {
  ldots: "…", dots: "…", textellipsis: "…",
  TeX: "T<sub>E</sub>X", LaTeX: "L<sup>A</sup>T<sub>E</sub>X",
  ",": " ", ";": " ", ":": " ", "!": "",
  " ": " ", "&": "&amp;", "%": "%", "_": "_", "#": "#", "$": "$",
  "{": "{", "}": "}", "textbackslash": "\\",
  quad: " ", qquad: "  ",
  ss: "ß", ae: "æ", oe: "œ", o: "ø", aa: "å", i: "ı", j: "ȷ", l: "ł",
  hspace: null,
};

const WRAP = {
  emph: ["<em>", "</em>"],
  textit: ["<em>", "</em>"],
  textbf: ["<strong>", "</strong>"],
  textsc: ['<span class="sc">', "</span>"],
  textnormal: ["", ""],
  textrm: ["", ""],
  texttt: ["<code>", "</code>"],
  underline: ["<u>", "</u>"],
  dif: ['<span class="dif">', "</span>"],
};

export function inline(src, ctx) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];

    if (c === "$") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "$") break;
        j++;
      }
      const tex = src.slice(i + 1, j);
      const rendered = math(ctx, tex, false);
      i = j + 1;
      // A KaTeX span is an atomic inline, so the browser is free to break
      // between it and the comma that follows.  Tie short formulas to their
      // neighbouring punctuation; long ones are left alone, because they need
      // their own internal break opportunities to stay inside the column.
      const punct = /^[.,;:!?)\]}’”]+/.exec(src.slice(i));
      const openm = /([([{“‘]+)$/.exec(out);
      if (tex.length <= 30 && (punct || openm)) {
        const open = openm ? openm[1] : "";
        if (open) out = out.slice(0, out.length - open.length);
        out += `<span class="nb">${open}${rendered}${punct ? punct[0] : ""}</span>`;
        if (punct) i += punct[0].length;
      } else {
        out += rendered;
      }
      continue;
    }

    if (c === "{" ) { const g = readGroup(src, i); out += inline(g.body, ctx); i = g.end; continue; }
    if (c === "}") { i++; continue; }

    if (c === "~") { out += " "; i++; continue; }
    if (c === "&") { out += "&amp;"; i++; continue; }
    if (c === "<") { out += "&lt;"; i++; continue; }
    if (c === ">") { out += "&gt;"; i++; continue; }

    if (c === "-") {
      if (src.startsWith("---", i)) { out += "—"; i += 3; continue; }
      if (src.startsWith("--", i)) { out += "–"; i += 2; continue; }
      out += "-"; i++; continue;
    }
    if (c === "`") {
      if (src[i + 1] === "`") { out += "“"; i += 2; continue; }
      out += "‘"; i++; continue;
    }
    if (c === "'") {
      if (src[i + 1] === "'") { out += "”"; i += 2; continue; }
      out += "’"; i++; continue;
    }
    if (c === "\n") { out += "\n"; i++; continue; }

    if (c !== "\\") { out += c; i++; continue; }

    // ---- a control sequence ----
    const next = src[i + 1];
    if (next === "\\") { out += "<br>"; i += 2; continue; }

    // accents written as \"a or \"{a}
    if (next !== undefined && ACCENTS[next] && !/[a-zA-Z]/.test(next)) {
      let j = i + 2, letter;
      if (src[j] === "{") { const g = readGroup(src, j); letter = g.body.trim(); j = g.end; }
      else { letter = src[j]; j++; }
      const map = ACCENTS[next];
      out += map[letter] || letter;
      i = j;
      continue;
    }

    const m = /^\\([a-zA-Z]+)\*?/.exec(src.slice(i));
    if (!m) {
      // \, \; \: \! \  and the escaped literals
      const sym = next;
      if (sym in SIMPLE) { out += SIMPLE[sym]; i += 2; continue; }
      out += esc(sym === undefined ? "\\" : sym);
      i += sym === undefined ? 1 : 2;
      continue;
    }
    const name = m[1];
    let j = i + m[0].length;

    // letter accents: \v{C}, \c{c}, \k{a} ...
    if (ACCENTS[name] && (src[j] === "{" || /^[A-Za-z]$/.test(src[j] || ""))) {
      let letter;
      if (src[j] === "{") { const g = readGroup(src, j); letter = g.body.trim(); j = g.end; }
      else { letter = src[j]; j++; }
      out += ACCENTS[name][letter] || letter;
      i = j;
      continue;
    }

    if (name in WRAP) {
      const g = readGroup(src, skipSpace(src, j));
      out += WRAP[name][0] + inline(g.body, ctx) + WRAP[name][1];
      i = g.end;
      continue;
    }

    switch (name) {
      case "cref": case "Cref": case "crefs": {
        const g = readGroup(src, skipSpace(src, j));
        out += crefHtml(g.body, ctx);
        i = g.end; continue;
      }
      case "eqref": case "ref": {
        const g = readGroup(src, skipSpace(src, j));
        const r = ctx.labels.get(g.body.trim());
        if (!r) { ctx.errors.push({ file: ctx.file, src: m[0], msg: "undefined label " + g.body }); out += "(??)"; }
        else out += link(r, name === "eqref" ? "(" + esc(r.num) + ")" : esc(r.num), ctx);
        i = g.end; continue;
      }
      case "hyperref": {
        const opt = readOptional(src, j);
        const g = readGroup(src, skipSpace(src, opt.end));
        const r = ctx.labels.get((opt.body || "").trim());
        out += r ? link(r, inline(g.body, ctx), ctx) : inline(g.body, ctx);
        i = g.end; continue;
      }
      case "url": {
        const g = readGroup(src, skipSpace(src, j));
        const u = g.body.trim();
        out += `<a class="url" href="${esc(u)}" target="_blank" rel="noopener">${breakUrl(u)}</a>`;
        i = g.end; continue;
      }
      case "text": case "mbox": {
        const g = readGroup(src, skipSpace(src, j));
        out += inline(g.body, ctx);
        i = g.end; continue;
      }
      case "label": {
        const g = readGroup(src, skipSpace(src, j));
        i = g.end; continue;   // anchors are emitted by the block renderer
      }
      case "footnote": {
        const g = readGroup(src, skipSpace(src, j));
        out += ` <span class="footnote">(${inline(g.body, ctx)})</span>`;
        i = g.end; continue;
      }
      case "ignorespaces": case "noindent": case "par": case "protect":
      case "sloppy": case "raggedbottom": case "linebreak": case "allowbreak":
        i = j; continue;
      default:
        if (name in SIMPLE) {
          if (SIMPLE[name] === null) { const g = readGroup(src, skipSpace(src, j)); i = g.end; continue; }
          out += SIMPLE[name]; i = j;
          // \ss etc. absorb a following {} if present
          if (src[i] === "{" && src[i + 1] === "}") i += 2;
          continue;
        }
        ctx.errors.push({ file: ctx.file, src: m[0], msg: "unhandled text command" });
        out += esc(m[0]);
        i = j;
        continue;
    }
  }
  return out;
}

const skipSpace = (s, i) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };

// Long URLs must be allowed to wrap on a phone; <wbr> after the separators
// \UrlBreaks names in bibliography.tex does exactly what the PDF does.
function breakUrl(u) {
  return esc(u).replace(/([/\-._?=&amp;~])/g, "$1<wbr>");
}

// --- tikz-cd ----------------------------------------------------------------
export function renderCD(src, ctx) {
  const b = /\\begin\{tikzcd\}/.exec(src);
  const e = src.lastIndexOf("\\end{tikzcd}");
  const opt = readOptional(src, b.index + b[0].length);
  const body = src.slice(opt.end, e);
  const opts = (opt.body || "");

  const rows = splitTop(body, "\\\\")
    .filter((r) => r.trim())
    .map((r) => splitTop(r, "&"));
  const R = rows.length, C = Math.max(...rows.map((r) => r.length));

  let diagonal = false;
  const cells = [];
  rows.forEach((row, ri) => {
    row.forEach((cell, ci) => {
      const { content, arrows } = parseCell(cell);
      cells.push({ ri, ci, content, arrows });
      for (const a of arrows) if (a.dir.length > 1) diagonal = true;
    });
  });

  let gap = /column sep=large/.test(opts) ? "3.2rem" : /column sep=small/.test(opts) ? "2rem" : "2.6rem";
  if (diagonal) gap = "2.8rem";           // square gaps keep the diagonal at 45°

  const out = [];
  for (const cell of cells) {
    const gr = cell.ri * 2 + 1, gc = cell.ci * 2 + 1;
    if (cell.content.trim())
      out.push(`<div class="cd-node" style="grid-area:${gr}/${gc}">${math(ctx, cell.content, false)}</div>`);
    for (const a of cell.arrows) {
      const lbl = a.label
        ? `<span class="cd-lbl ${a.side}">${math(ctx, a.label, false)}</span>` : "";
      const cls = ["cd-arr", "cd-" + a.dir, a.dashed ? "cd-dashed" : ""].join(" ");
      const diag = a.dir.length === 2 ? diagonalSvg(a.dir, a.dashed) : "";
      let area;
      if (a.dir === "r") area = `${gr}/${gc + 1}`;
      else if (a.dir === "l") area = `${gr}/${gc - 1}`;
      else if (a.dir === "d") area = `${gr + 1}/${gc}`;
      else if (a.dir === "u") area = `${gr - 1}/${gc}`;
      else if (a.dir === "ur") area = `${gr - 1}/${gc + 1}`;
      else if (a.dir === "dr") area = `${gr + 1}/${gc + 1}`;
      else if (a.dir === "ul") area = `${gr - 1}/${gc - 1}`;
      else if (a.dir === "dl") area = `${gr + 1}/${gc - 1}`;
      else { ctx.errors.push({ file: ctx.file, src, msg: "unhandled arrow direction " + a.dir }); continue; }
      out.push(`<div class="${cls}" style="grid-area:${area}">${diag}${lbl}</div>`);
    }
  }
  const style = `--cd-gap:${gap};grid-template-columns:repeat(${C - 1},auto var(--cd-gap)) auto;`
    + `grid-template-rows:repeat(${R - 1},auto var(--cd-gap)) auto`;
  return `<div class="dispwrap cdwrap"><div class="cd" style="${style}">${out.join("")}</div></div>`;
}

// A diagonal arrow lands in the square gap cell between two nodes, so an SVG on
// a 100x100 viewBox is undistorted and exactly 45 degrees.  Horizontal and
// vertical arrows are drawn in CSS, where they stretch with the grid.
function diagonalSvg(dir, dashed) {
  const up = dir[0] === "u";
  const right = dir[1] === "r";
  const [x0, y0, x1, y1, tx, ty] = up ? [2, 98, 84, 16, 97, 3] : [2, 2, 84, 84, 97, 97];
  const fx = right ? (v) => v : (v) => 100 - v;
  const pts = arrowHead(fx(tx), ty, fx(x1) - fx(tx), y1 - ty);
  return `<svg class="cd-svg" viewBox="0 0 100 100" aria-hidden="true">`
    + `<line x1="${fx(x0)}" y1="${y0}" x2="${fx(x1)}" y2="${y1}"`
    + ` vector-effect="non-scaling-stroke"${dashed ? ' stroke-dasharray="6 4"' : ""}/>`
    + `<polygon points="${pts}"/></svg>`;
}
function arrowHead(tipX, tipY, backX, backY) {
  const L = Math.hypot(backX, backY);
  const ux = backX / L, uy = backY / L;           // unit vector, tip -> tail
  const len = 19, half = 6.6;
  const bx = tipX + ux * len, by = tipY + uy * len;
  const px = -uy * half, py = ux * half;
  return `${r(tipX)},${r(tipY)} ${r(bx + px)},${r(by + py)} ${r(bx - px)},${r(by - py)}`;
}
const r = (v) => Math.round(v * 10) / 10;

function splitTop(s, sep) {
  const parts = [];
  let depth = 0, buf = "", i = 0;
  while (i < s.length) {
    if (s[i] === "\\" && s.startsWith(sep, i) && sep === "\\\\" && depth === 0) { parts.push(buf); buf = ""; i += 2; continue; }
    if (s[i] === "\\") { buf += s.slice(i, i + 2); i += 2; continue; }
    if (s[i] === "{" || s[i] === "[") depth++;
    if (s[i] === "}" || s[i] === "]") depth--;
    if (depth === 0 && sep === "&" && s[i] === "&") { parts.push(buf); buf = ""; i++; continue; }
    buf += s[i]; i++;
  }
  parts.push(buf);
  return parts;
}

function parseCell(cell) {
  let content = "", arrows = [], i = 0;
  while (i < cell.length) {
    if (cell.startsWith("\\arrow", i) || cell.startsWith("\\ar[", i)) {
      let j = i + (cell.startsWith("\\arrow", i) ? 6 : 3);
      while (j < cell.length && /\s/.test(cell[j])) j++;
      const o = readOptional(cell, j);
      arrows.push(parseArrowSpec(o.body || ""));
      i = o.end;
      continue;
    }
    if (cell[i] === "\\") { content += cell.slice(i, i + 2); i += 2; continue; }
    content += cell[i]; i++;
  }
  return { content, arrows };
}

function parseArrowSpec(spec) {
  const items = [];
  let buf = "", depth = 0, inq = false, i = 0;
  while (i < spec.length) {
    const c = spec[i];
    if (c === "\\") { buf += spec.slice(i, i + 2); i += 2; continue; }
    if (c === '"') { inq = !inq; buf += c; i++; continue; }
    if (!inq && (c === "{" || c === "[")) depth++;
    if (!inq && (c === "}" || c === "]")) depth--;
    if (!inq && depth === 0 && c === ",") { items.push(buf.trim()); buf = ""; i++; continue; }
    buf += c; i++;
  }
  if (buf.trim()) items.push(buf.trim());

  const a = { dir: "r", label: null, side: "", dashed: false };
  for (const it of items) {
    if (/^[rlud]{1,2}$/.test(it)) { a.dir = it; continue; }
    if (it === "dashed") { a.dashed = true; continue; }
    const q = /^"(.*)"(')?$/s.exec(it);
    if (q) { a.label = q[1]; a.prime = !!q[2]; continue; }
  }
  // tikz-cd puts a label to the left of the direction of travel; ' swaps it.
  // Travelling east, left is north (above); travelling south, left is east.
  const base = { r: "cd-above", l: "cd-below", d: "cd-right", u: "cd-left" };
  const flip = { "cd-above": "cd-below", "cd-below": "cd-above", "cd-left": "cd-right", "cd-right": "cd-left" };
  let side = base[a.dir] || "cd-above";
  if (a.prime) side = flip[side];
  a.side = side;
  return a;
}

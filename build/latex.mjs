// ---------------------------------------------------------------------------
// latex.mjs — a small, deliberately narrow LaTeX reader for this book.
//
// It understands exactly the subset that book/main.tex, book/preamble.tex and
// book/chapters/*.tex actually use.  Nothing is guessed: every command handled
// below was found by scanning the sources, and anything unknown makes the build
// fail loudly rather than silently dropping mathematics.
//
// Math is never rewritten here.  Prose and math are separated first, prose is
// translated to HTML, and the math is handed to KaTeX exactly as the author
// wrote it, with book/preamble.tex's macros supplied as KaTeX macros.
// ---------------------------------------------------------------------------

// --- the book's own macros, transcribed from preamble.tex --------------------
export const MACROS = {
  "\\RR": "\\mathbb{R}",
  "\\ZZ": "\\mathbb{Z}",
  "\\QQ": "\\mathbb{Q}",
  "\\CC": "\\mathbb{C}",
  "\\FF": "\\mathbb{F}",
  "\\RP": "\\mathbb{RP}",
  "\\PP": "\\mathbb{P}",
  "\\CP": "\\mathbb{CP}",
  "\\Ext": "\\operatorname{Ext}",
  "\\Tor": "\\operatorname{Tor}",
  "\\Hom": "\\operatorname{Hom}",
  "\\im": "\\operatorname{im}",
  "\\coker": "\\operatorname{coker}",
  "\\Sq": "\\operatorname{Sq}",
  "\\Sing": "\\operatorname{Sing}",
  "\\Lan": "\\operatorname{Lan}",
  "\\Ass": "\\operatorname{Ass}",
  "\\Com": "\\operatorname{Com}",
  "\\End": "\\operatorname{End}",
  "\\shom": "\\mathfrak{C}",
};

// mathtools ships \begin{psmallmatrix}; KaTeX does not.  Rewriting it to the
// bracketed smallmatrix KaTeX does ship is exact, not an approximation.
export function normaliseMath(src) {
  return src
    .replace(/\\begin\{psmallmatrix\}/g, "\\left(\\begin{smallmatrix}")
    .replace(/\\end\{psmallmatrix\}/g, "\\end{smallmatrix}\\right)");
}

// --- comment stripping ------------------------------------------------------
// A TeX comment eats the rest of the line, the newline, and the leading white
// space of the next line.  Getting that right is what keeps commented-out
// paragraphs from silently fusing two paragraphs into one.
export function stripComments(src) {
  const lines = src.split("\n");
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let cut = -1;
    for (let j = 0; j < line.length; j++) {
      if (line[j] === "\\") { j++; continue; }
      if (line[j] === "%") { cut = j; break; }
    }
    if (cut < 0) {
      out += line + "\n";
    } else {
      out += line.slice(0, cut);
      if (i + 1 < lines.length) lines[i + 1] = lines[i + 1].replace(/^[ \t]+/, "");
    }
  }
  return out;
}

// --- balanced-group reading -------------------------------------------------
export function readGroup(src, i) {
  // src[i] must be '{'; returns {body, end} with end just past the '}'
  if (src[i] !== "{") throw new Error("expected { at " + i + " near: " + src.slice(i, i + 40));
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "\\") { j++; continue; }
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) return { body: src.slice(i + 1, j), end: j + 1 };
    }
  }
  throw new Error("unbalanced { at " + i + " near: " + src.slice(i, i + 60));
}

export function readOptional(src, i) {
  // returns {body, end}; body null when there is no [...] at i.  Only spaces
  // and tabs are skipped: a line break means the [ belongs to the text.
  let j = i;
  while (j < src.length && (src[j] === " " || src[j] === "\t")) j++;
  if (src[j] !== "[") return { body: null, end: i };
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "\\") { k++; continue; }
    if (src[k] === "{") { const g = readGroup(src, k); k = g.end - 1; continue; }
    if (src[k] === "[") depth++;
    else if (src[k] === "]") {
      depth--;
      if (depth === 0) return { body: src.slice(j + 1, k), end: k + 1 };
    }
  }
  throw new Error("unbalanced [ at " + j);
}

// --- block-level parsing ----------------------------------------------------
export const THM_ENVS = new Set([
  "theorem", "proposition", "lemma", "corollary",
  "definition", "example", "construction", "exercise",
  "remark", "warning",
]);
const BLOCK_ENVS = new Set([
  ...THM_ENVS, "proof", "hint", "hints", "solution",
  "itemize", "enumerate", "equation",
]);

// Commands that carry structure rather than text.
const NULL_CMDS = new Set([
  "sloppy", "raggedbottom", "makeatletter", "makeatother",
  "noindent", "smallskip", "medskip", "bigskip", "par", "clearpage", "newpage",
]);

/**
 * Parse a chapter body into a list of block nodes.
 * Node kinds: chapter, section, subsection, paragraph, para, thm, proof,
 * aside (hint/hints/solution), list, display, equation, cd, label
 */
export function parseBlocks(src) {
  const nodes = [];
  let text = "";
  let i = 0;

  // "continuing" marks a paragraph that follows displayed material without an
  // intervening blank line — one LaTeX would not indent.
  let continuing = false;

  const flush = () => {
    const parts = text.split(/\n[ \t]*\n+/);
    let first = true;
    for (const p of parts) {
      const t = p.trim();
      if (!t) continue;
      nodes.push({ k: "para", text: t, cont: first && continuing });
      first = false;
    }
    text = "";
    continuing = false;
  };

  while (i < src.length) {
    const c = src[i];

    // inline math: consume verbatim so that structural scanning never looks
    // inside mathematics
    if (c === "$") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "$") break;
        j++;
      }
      text += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (c !== "\\") { text += c; i++; continue; }

    // escaped literal
    if ("$%&#_{}".includes(src[i + 1])) { text += src.slice(i, i + 2); i += 2; continue; }

    // display math \[ ... \]
    if (src[i + 1] === "[") {
      const end = src.indexOf("\\]", i + 2);
      if (end < 0) throw new Error("unterminated \\[");
      const inner = src.slice(i + 2, end).trim();
      flush();
      if (/\\begin\{tikzcd\}/.test(inner)) nodes.push({ k: "cd", src: inner });
      else nodes.push({ k: "display", math: inner });
      i = end + 2;
      continuing = true;
      // a blank line after the display ends the continuation
      const rest = src.slice(i);
      if (/^[ \t]*\n[ \t]*\n/.test(rest)) continuing = false;
      continue;
    }

    const m = /^\\([a-zA-Z]+)\*?/.exec(src.slice(i));
    if (!m) { text += src.slice(i, i + 2); i += 2; continue; }
    const raw = m[0];
    const name = m[1];
    const starred = raw.endsWith("*");
    let j = i + raw.length;

    if (name === "begin") {
      const g = readGroup(src, j);
      const env = g.body.trim();
      if (BLOCK_ENVS.has(env)) {
        const { inner, end } = matchEnv(src, g.end, env);
        const opt = readOptional(src, g.end);
        const body = opt.body !== null ? src.slice(opt.end, inner.stop) : inner.text;
        flush();
        nodes.push(makeEnvNode(env, opt.body, body));
        i = end;
        continuing = env === "equation" && !/^[ \t]*\n[ \t]*\n/.test(src.slice(i));
        continue;
      }
      throw new Error("unhandled environment: " + env);
    }

    if (name === "end") { throw new Error("stray \\end near " + src.slice(i, i + 40)); }

    switch (name) {
      case "chapter": {
        const opt = readOptional(src, j);
        const g = readGroup(src, opt.end);
        flush();
        nodes.push({ k: "chapter", title: g.body, short: opt.body, starred });
        i = g.end; continuing = false; continue;
      }
      case "section":
      case "subsection": {
        const opt = readOptional(src, j);
        const g = readGroup(src, opt.end);
        flush();
        nodes.push({ k: name, title: g.body, starred });
        i = g.end; continuing = false; continue;
      }
      case "paragraph": {
        const g = readGroup(src, j);
        flush();
        nodes.push({ k: "paragraph", title: g.body });
        i = g.end; continuing = false; continue;
      }
      case "label": {
        const g = readGroup(src, j);
        flush();
        nodes.push({ k: "label", name: g.body.trim() });
        i = g.end; continue;
      }
      case "purpose": {
        // POLICY §9: not printed (\purposevisiblefalse in preamble.tex)
        const g = readGroup(src, j);
        i = g.end;
        // swallow the blank line the note would have occupied
        continue;
      }
      case "item": {
        flush();
        const opt = readOptional(src, j);
        nodes.push({ k: "item", opt: opt.body });
        i = opt.end; continue;
      }
      case "def": {
        // \def\UrlBreaks{...} in bibliography.tex — typesetting only
        let k = j;
        while (k < src.length && src[k] !== "{") k++;
        const g = readGroup(src, k);
        i = g.end; continue;
      }
      default:
        if (NULL_CMDS.has(name)) { i = j; continue; }
        // an inline command: leave it for the inline renderer
        text += raw;
        i = j;
        continue;
    }
  }
  flush();
  return nodes;
}

function matchEnv(src, from, env) {
  const open = new RegExp("\\\\begin\\{" + env + "\\}", "g");
  const close = new RegExp("\\\\end\\{" + env + "\\}", "g");
  let depth = 1;
  let pos = from;
  while (depth > 0) {
    open.lastIndex = pos; close.lastIndex = pos;
    const o = open.exec(src);
    const c = close.exec(src);
    if (!c) throw new Error("unterminated environment " + env);
    if (o && o.index < c.index) { depth++; pos = o.index + o[0].length; }
    else { depth--; pos = c.index + c[0].length; if (depth === 0) return { inner: { text: src.slice(from, c.index), stop: c.index }, end: pos }; }
  }
  throw new Error("unreachable");
}

function makeEnvNode(env, opt, body) {
  if (THM_ENVS.has(env)) return { k: "thm", kind: env, opt, body: parseBlocks(body) };
  if (env === "proof") return { k: "proof", opt, body: parseBlocks(body) };
  if (env === "hint" || env === "hints" || env === "solution")
    return { k: "aside", kind: env, opt, body: parseBlocks(body) };
  if (env === "equation") return { k: "equation", math: body.trim() };
  if (env === "itemize" || env === "enumerate")
    return { k: "list", ordered: env === "enumerate", opt, items: splitItems(body) };
  throw new Error("unhandled block env " + env);
}

function splitItems(body) {
  const parts = parseBlocks(body);
  const items = [];
  let cur = null;
  for (const n of parts) {
    if (n.k === "item") { cur = { opt: n.opt, body: [] }; items.push(cur); continue; }
    if (cur) cur.body.push(n);
    else if (n.k === "para" && !n.text.trim()) continue;
    else if (n.k === "para") throw new Error("text before first \\item: " + n.text.slice(0, 40));
    else throw new Error("block before first \\item");
  }
  return items;
}

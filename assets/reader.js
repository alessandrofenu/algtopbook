/* ---------------------------------------------------------------------------
   reader.js — the small amount of behaviour the reader needs.
   The mathematics is pre-rendered at build time, so nothing here is on the
   critical path for displaying the page.
   --------------------------------------------------------------------------- */
(function () {
  "use strict";

  var doc = document;
  var drawer = doc.getElementById("drawer");
  var menuBtn = doc.getElementById("menu-btn");
  var scrim = doc.getElementById("scrim");
  var progress = doc.getElementById("progress");
  var toTop = doc.getElementById("totop");
  var themeBtn = doc.getElementById("theme-btn");

  // --- table of contents drawer --------------------------------------------
  function setDrawer(open) {
    if (!drawer) return;
    drawer.classList.toggle("open", open);
    if (menuBtn) menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    doc.documentElement.style.overflow = open && !isWide() ? "hidden" : "";
    if (open) {
      var here = drawer.querySelector(".toc-ch.here");
      if (here && here.scrollIntoView) here.scrollIntoView({ block: "center" });
    }
  }
  function isWide() { return window.matchMedia("(min-width: 64em)").matches; }

  if (menuBtn) menuBtn.addEventListener("click", function () {
    setDrawer(!drawer.classList.contains("open"));
  });
  if (scrim) scrim.addEventListener("click", function () { setDrawer(false); });
  doc.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setDrawer(false);
  });
  if (drawer) drawer.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("a") : null;
    if (a && !isWide()) setDrawer(false);
  });

  // --- reading progress and back-to-top ------------------------------------
  var ticking = false, lastY = 0;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var h = doc.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var y = window.scrollY || h.scrollTop;
      if (progress) progress.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";
      // offer the way back only when the reader is already heading upwards,
      // so the button never sits on top of the line being read
      if (toTop) toTop.classList.toggle("show", y > 1200 && y < lastY - 4);
      if (Math.abs(y - lastY) > 4) lastY = y;
      ticking = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  if (toTop) toTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // --- day / night ----------------------------------------------------------
  if (themeBtn) themeBtn.addEventListener("click", function () {
    var el = doc.documentElement;
    var dark = el.dataset.theme
      ? el.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    el.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("agcat-theme", el.dataset.theme); } catch (e) {}
  });

  // --- wide mathematics: flag the boxes that actually scroll ----------------
  var boxes = [].slice.call(doc.querySelectorAll(".dispwrap"));
  function markScrollers() {
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      // a display that KaTeX has broken over several lines is centred line by
      // line, which reads badly; flag it so the stylesheet can align it left
      var bases = b.querySelectorAll(".katex-display > .katex > .katex-html > .base");
      var wrapped = bases.length > 1 &&
        bases[bases.length - 1].offsetTop - bases[0].offsetTop > 3;
      b.classList.toggle("is-wrapped", wrapped);

      b.classList.toggle("is-scroll", b.scrollWidth - b.clientWidth > 2);
      if (b.scrollWidth - b.clientWidth > 2) {
        if (!b.hasAttribute("tabindex")) {
          b.setAttribute("tabindex", "0");
          b.setAttribute("role", "region");
          b.setAttribute("aria-label", "Scrollable equation");
        }
      } else {
        b.removeAttribute("tabindex");
        b.removeAttribute("role");
        b.removeAttribute("aria-label");
      }
    }
  }
  markScrollers();
  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(markScrollers, 120);
  });
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(markScrollers);

  // --- highlight the section being read in the contents --------------------
  var secLinks = [].slice.call(doc.querySelectorAll(".toc-secs a"));
  if (secLinks.length && "IntersectionObserver" in window) {
    var byId = {};
    secLinks.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var heads = [].slice.call(doc.querySelectorAll(".page h2[id]"))
      .filter(function (h) { return byId[h.id]; });
    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting; });
      var current = null;
      for (var i = 0; i < heads.length; i++) {
        if (heads[i].getBoundingClientRect().top < window.innerHeight * 0.4) current = heads[i].id;
      }
      secLinks.forEach(function (a) { a.classList.remove("here"); });
      if (current && byId[current]) byId[current].classList.add("here");
    }, { rootMargin: "-10% 0px -60% 0px", threshold: 0 });
    heads.forEach(function (h) { io.observe(h); });
  }

  // --- keyboard: left / right move between chapters -------------------------
  doc.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    var sel = e.key === "ArrowLeft" ? ".pager-prev" : e.key === "ArrowRight" ? ".pager-next" : null;
    if (!sel) return;
    var a = doc.querySelector(sel);
    if (a) window.location.href = a.getAttribute("href");
  });
})();

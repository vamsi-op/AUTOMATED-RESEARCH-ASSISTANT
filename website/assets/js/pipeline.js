/* ============================================================================
   Automated Research Assistant — Animated "How it works" pipeline
   Cycles through Upload → Embed → Retrieve → Generate, each with its own
   self-contained animation. Click a step to jump; auto-advances otherwise.
   ============================================================================ */
(function () {
  "use strict";

  const stage = document.getElementById("pipeline-stage");
  if (!stage) return;

  const scenes = Array.prototype.slice.call(stage.querySelectorAll(".scene"));
  const steps = Array.prototype.slice.call(stage.querySelectorAll(".pstep"));
  const SCENE_MS = 3900;

  const reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── Build the embed vector grid (staggered pop-in) ────────────────────────
  const grid = document.getElementById("em-grid");
  if (grid) {
    for (let i = 0; i < 40; i++) {
      const d = document.createElement("span");
      d.className = "em-dot";
      d.style.animationDelay = (1.0 + i * 0.03).toFixed(2) + "s";
      grid.appendChild(d);
    }
  }

  // ── Build the retrieve node field ─────────────────────────────────────────
  const field = document.getElementById("rt-field");
  const HITS = [7, 14, 23];
  if (field) {
    for (let i = 0; i < 30; i++) {
      const n = document.createElement("span");
      n.className = "rt-node";
      field.appendChild(n);
    }
  }

  const genText = document.getElementById("gen-text");
  const genCite = genText ? genText.parentElement.querySelector(".gen-cite") : null;
  const ANSWER =
    "Attention lets the model weigh how relevant every token is to all the " +
    "others, replacing recurrence with direct connections for better context.";

  let current = -1;
  let typingId = 0;
  let timer = null;

  function resetScene(n) {
    // Clear retrieve highlights
    if (field) field.querySelectorAll(".rt-node").forEach((x) => x.classList.remove("hit"));
    // Reset generate text
    if (genText) genText.textContent = "";
    if (genCite) genCite.classList.remove("show");
  }

  function activateScene(n) {
    const scene = scenes[n];
    if (scene.classList.contains("scene-retrieve") && field) {
      const nodes = field.querySelectorAll(".rt-node");
      HITS.forEach((idx, k) => {
        setTimeout(() => { if (nodes[idx]) nodes[idx].classList.add("hit"); }, 700 + k * 350);
      });
    }
    if (scene.classList.contains("scene-generate") && genText) {
      typeAnswer();
    }
  }

  function typeAnswer() {
    const id = ++typingId;
    let i = 0;
    if (genCite) genCite.classList.remove("show");
    genText.textContent = "";
    if (reduceMotion) {
      genText.textContent = ANSWER;
      if (genCite) genCite.classList.add("show");
      return;
    }
    const speed = Math.max(14, Math.floor(2400 / ANSWER.length));
    (function tick() {
      if (id !== typingId) return;           // a newer scene took over
      genText.textContent = ANSWER.slice(0, i);
      i++;
      if (i <= ANSWER.length) setTimeout(tick, speed);
      else if (genCite) genCite.classList.add("show");
    })();
  }

  function show(n) {
    if (n === current) return;
    if (current >= 0) resetScene(current);
    current = n;
    scenes.forEach((s, k) => s.classList.toggle("active", k === n));
    steps.forEach((s, k) => s.classList.toggle("active", k === n));
    activateScene(n);
  }

  function next() { show((current + 1) % scenes.length); }

  function startAuto() {
    if (reduceMotion) return;
    stopAuto();
    timer = setInterval(next, SCENE_MS);
  }
  function stopAuto() { if (timer) { clearInterval(timer); timer = null; } }

  // Manual step selection
  steps.forEach((btn) => {
    btn.addEventListener("click", () => {
      stopAuto();
      show(parseInt(btn.dataset.i, 10));
      startAuto();
    });
  });

  // Only run while the section is on screen
  show(0);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) startAuto();
        else stopAuto();
      },
      { threshold: 0.25 }
    ).observe(stage);
  } else {
    startAuto();
  }
})();

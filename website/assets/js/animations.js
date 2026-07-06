/* ============================================================================
   ScholarAI — Landing page interactions & animations
   ============================================================================ */
(function () {
  "use strict";

  /* ---- Year in footer ---- */
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---- Navbar shadow on scroll ---- */
  const nav = document.getElementById("nav");
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle("scrolled", window.scrollY > 20);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---- Mobile nav toggle (simple reveal of links) ---- */
  const toggle = document.getElementById("navToggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.style.display === "flex";
      links.style.display = open ? "" : "flex";
      links.style.position = "absolute";
      links.style.top = "68px";
      links.style.left = "0";
      links.style.right = "0";
      links.style.flexDirection = "column";
      links.style.gap = "0";
      links.style.padding = open ? "0" : "16px 24px";
      links.style.background = "rgba(6,8,16,0.96)";
      links.style.borderBottom = open ? "none" : "1px solid rgba(148,163,184,0.12)";
    });
    // Close after clicking a link
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => {
        if (window.innerWidth <= 940) links.style.display = "";
      })
    );
  }

  /* ---- Scroll reveal via IntersectionObserver ---- */
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    );
    revealEls.forEach((el) => {
      // Hero elements already marked .in stay visible
      if (!el.classList.contains("in")) io.observe(el);
    });
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }

  /* ---- Animated stat counters ---- */
  const counters = document.querySelectorAll("[data-count]");
  const animateCount = (el) => {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || "";
    const dur = 1400;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = Math.round(target * eased);
      el.textContent = val + suffix;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = target + suffix;
    };
    requestAnimationFrame(step);
  };
  if ("IntersectionObserver" in window) {
    const co = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            animateCount(e.target);
            co.unobserve(e.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    counters.forEach((c) => co.observe(c));
  } else {
    counters.forEach((c) => (c.textContent = c.dataset.count + (c.dataset.suffix || "")));
  }

  /* ---- Feature card spotlight (follow cursor) ---- */
  document.querySelectorAll("[data-tilt]").forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });

  /* ---- FAQ accordion ---- */
  document.querySelectorAll(".faq-item").forEach((item) => {
    const q = item.querySelector(".faq-q");
    const a = item.querySelector(".faq-a");
    q.addEventListener("click", () => {
      const open = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach((other) => {
        if (other !== item) {
          other.classList.remove("open");
          other.querySelector(".faq-a").style.maxHeight = null;
        }
      });
      item.classList.toggle("open", !open);
      a.style.maxHeight = open ? null : a.scrollHeight + "px";
    });
  });

  /* ---- Demo chat: swap typing bubble for an answer ---- */
  const demo = document.getElementById("demoChat");
  if (demo) {
    setTimeout(() => {
      const typing = demo.querySelector(".chat-bubble.bot .typing");
      if (typing) {
        const bubble = typing.closest(".chat-bubble");
        bubble.innerHTML =
          'Scaled dot-product attention computes softmax(QKᵀ/√d)·V — the queries and keys score how much each token attends to the others, then weight the values accordingly.' +
          '<span class="cite">📄 Attention Is All You Need · p.4 · 0.91</span>';
      }
    }, 2600);
  }
})();

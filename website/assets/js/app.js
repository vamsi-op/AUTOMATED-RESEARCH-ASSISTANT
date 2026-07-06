/* ============================================================================
   ScholarAI — Application logic + typed API client
   Talks to the FastAPI backend defined in config.js (window.SCHOLARAI).
   ============================================================================ */
(function () {
  "use strict";

  const cfg = window.SCHOLARAI;
  const $ = (id) => document.getElementById(id);
  const el = (sel, root = document) => root.querySelector(sel);

  /* ------------------------------------------------------------------ */
  /*  API client                                                         */
  /* ------------------------------------------------------------------ */
  const api = {
    base: () => cfg.API,
    async _req(path, opts = {}) {
      const res = await fetch(cfg.API + path, opts);
      const isJson = (res.headers.get("content-type") || "").includes("application/json");
      const body = isJson ? await res.json().catch(() => null) : await res.text();
      if (!res.ok) {
        const detail = body && body.detail ? (typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)) : res.statusText;
        const err = new Error(detail || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return body;
    },
    health() { return this._req("/health"); },
    listPapers() { return this._req("/papers?limit=100"); },
    query(question, topK = 5) {
      return this._req("/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, top_k: topK, include_citations: true }),
      });
    },
    summarize(paperId, type) {
      return this._req("/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_id: paperId, summary_type: type }),
      });
    },
    review(topic, maxPapers = 10) {
      return this._req("/literature-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, max_papers: maxPapers }),
      });
    },
    upload(file, onProgress) {
      // XHR for upload progress
      return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append("file", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", cfg.API + "/papers/upload");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        };
        xhr.onload = () => {
          let data = null;
          try { data = JSON.parse(xhr.responseText); } catch (e) {}
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error((data && data.detail && (data.detail.detail || data.detail)) || `Upload failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(form);
      });
    },
    deletePaper(id, pin) {
      const headers = {};
      if (pin) headers["X-Admin-Pin"] = pin;
      return this._req("/papers/" + id, { method: "DELETE", headers });
    },
  };

  /* ------------------------------------------------------------------ */
  /*  Utilities                                                          */
  /* ------------------------------------------------------------------ */
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(msg, type = "info") {
    const wrap = $("toastWrap");
    const t = document.createElement("div");
    t.className = "toast " + type;
    const icon = type === "success" ? "✅" : type === "error" ? "⚠️" : "ℹ️";
    t.innerHTML = `<span>${icon}</span><span>${escapeHtml(msg)}</span>`;
    wrap.appendChild(t);
    setTimeout(() => {
      t.style.transition = "opacity .3s, transform .3s";
      t.style.opacity = "0";
      t.style.transform = "translateY(10px)";
      setTimeout(() => t.remove(), 300);
    }, 3200);
  }

  /* ------------------------------------------------------------------ */
  /*  Tabs                                                               */
  /* ------------------------------------------------------------------ */
  $("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + tab));
    if (tab === "papers") loadPapers();
    if (tab === "summarize") loadPaperOptions();
  });

  /* ------------------------------------------------------------------ */
  /*  Health status                                                      */
  /* ------------------------------------------------------------------ */
  let healthTries = 0;
  async function checkHealth() {
    const pill = $("statusPill");
    const text = $("statusText");
    try {
      const h = await api.health();
      healthTries = 0;
      const ok = h.qdrant_connected && h.groq_available;
      pill.className = "status-pill " + (ok ? "ok" : "bad");
      pill.querySelector(".dot").classList.remove("pulse");
      text.innerHTML = ok
        ? `Healthy · Qdrant ✓ · Groq ✓`
        : `Degraded · Qdrant ${h.qdrant_connected ? "✓" : "✗"} · Groq ${h.groq_available ? "✓" : "✗"}`;
    } catch (e) {
      healthTries++;
      pill.className = "status-pill";
      text.textContent = healthTries < 15 ? "Starting up…" : "Backend offline";
      if (healthTries < 15) setTimeout(checkHealth, 4000);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Chat                                                               */
  /* ------------------------------------------------------------------ */
  const chatWindow = $("chatWindow");

  function addMsg(role, html) {
    const empty = $("chatEmpty");
    if (empty) empty.remove();
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.innerHTML = html;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return div;
  }

  async function sendQuery() {
    const input = $("chatInput");
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    addMsg("user", escapeHtml(q));
    const loading = addMsg("bot", `<span class="loading-row"><span class="spinner"></span> Thinking…</span>`);
    try {
      const data = await api.query(q);
      let html = escapeHtml(data.answer || "No answer returned.");
      if (data.citations && data.citations.length) {
        html += '<div class="cites">';
        data.citations.forEach((c) => {
          const score = c.relevance_score != null ? " · " + c.relevance_score.toFixed(2) : "";
          html += `<span class="cite">📄 ${escapeHtml(c.paper_title || "Source")}${c.page_number ? " · p." + c.page_number : ""}${score}</span>`;
        });
        html += "</div>";
      }
      if (data.processing_time != null) {
        html += `<div class="meta">${data.retrieved_chunks || 0} chunks · ${data.processing_time.toFixed(2)}s</div>`;
      }
      loading.innerHTML = html;
    } catch (e) {
      loading.innerHTML = `<span style="color:var(--danger)">⚠️ ${escapeHtml(e.message)}</span>`;
    }
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  $("sendBtn").addEventListener("click", sendQuery);
  $("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); sendQuery(); }
  });
  $("exampleChips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    $("chatInput").value = chip.textContent;
    sendQuery();
  });

  /* ------------------------------------------------------------------ */
  /*  Upload                                                             */
  /* ------------------------------------------------------------------ */
  const dropzone = $("dropzone");
  const fileInput = $("fileInput");

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag");
    if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) uploadFile(e.target.files[0]);
  });

  function setStep(name, state) {
    const step = document.querySelector(`.pstep[data-step="${name}"]`);
    if (!step) return;
    step.className = "pstep " + state;
    const ico = step.querySelector(".pico");
    ico.textContent = state === "done" ? "✓" : state === "active" ? "●" : "○";
  }

  async function uploadFile(file) {
    if (!file.name.toLowerCase().endsWith(".pdf")) { toast("Only PDF files are supported", "error"); return; }
    const steps = $("uploadSteps");
    const result = $("uploadResult");
    result.innerHTML = "";
    steps.classList.add("show");
    ["extract", "chunk", "embed", "index"].forEach((s) => setStep(s, ""));
    setStep("extract", "active");

    // Simulated visual progression while the request is in flight
    const timers = [
      setTimeout(() => { setStep("extract", "done"); setStep("chunk", "active"); }, 900),
      setTimeout(() => { setStep("chunk", "done"); setStep("embed", "active"); }, 2000),
      setTimeout(() => { setStep("embed", "done"); setStep("index", "active"); }, 3400),
    ];

    try {
      const data = await api.upload(file);
      timers.forEach(clearTimeout);
      ["extract", "chunk", "embed", "index"].forEach((s) => setStep(s, "done"));
      const m = data.metadata || {};
      result.innerHTML = `
        <div class="card" style="background:rgba(52,211,153,0.08); border:1px solid rgba(52,211,153,0.25); margin-top:18px">
          <div style="font-weight:700; color:var(--success); margin-bottom:8px">✅ Indexed successfully</div>
          <div class="ptitle">${escapeHtml(m.title || file.name)}</div>
          <div class="tags">
            <span class="tag">${data.num_chunks || 0} chunks</span>
            ${data.processing_time ? `<span class="tag gray">${data.processing_time.toFixed(1)}s</span>` : ""}
            ${m.num_pages ? `<span class="tag gray">${m.num_pages} pages</span>` : ""}
          </div>
        </div>`;
      toast("Paper indexed", "success");
      loadPapers();
      loadPaperOptions();
    } catch (e) {
      timers.forEach(clearTimeout);
      steps.classList.remove("show");
      result.innerHTML = `<div style="color:var(--danger); margin-top:16px">⚠️ ${escapeHtml(e.message)}</div>`;
      toast(e.message, "error");
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Papers                                                             */
  /* ------------------------------------------------------------------ */
  async function loadPapers() {
    const list = $("papersList");
    list.innerHTML = `<div class="loading-row"><span class="spinner"></span> Loading papers…</div>`;
    try {
      const papers = await api.listPapers();
      if (!papers.length) {
        list.innerHTML = `<div class="empty-state"><div class="big">📚</div><p>No papers indexed yet</p></div>`;
        return;
      }
      list.innerHTML = papers.map((p) => {
        const m = p.metadata || {};
        const tags = [`<span class="tag">${p.num_chunks} chunks</span>`]
          .concat((p.sections || []).slice(0, 3).map((s) => `<span class="tag gray">${escapeHtml(s)}</span>`))
          .join("");
        return `
          <div class="paper glass">
            <div style="min-width:0">
              <div class="ptitle">${escapeHtml(m.title || "Untitled")}</div>
              <div class="pid">${escapeHtml(p.paper_id.slice(0, 8))}…</div>
              <div class="tags">${tags}</div>
            </div>
            <button class="icon-btn danger" data-del="${escapeHtml(p.paper_id)}" title="Delete">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>`;
      }).join("");
    } catch (e) {
      list.innerHTML = `<div style="color:var(--danger)">⚠️ ${escapeHtml(e.message)}</div>`;
    }
  }

  $("papersList").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-del]");
    if (!btn) return;
    const id = btn.dataset.del;
    const pin = prompt("Enter admin PIN to delete this paper:\n(Leave blank if no PIN is configured)") ?? null;
    if (pin === null) return;
    try {
      await api.deletePaper(id, pin);
      toast("Paper deleted", "success");
      loadPapers();
      loadPaperOptions();
    } catch (err) {
      toast(err.status === 401 ? "Invalid PIN" : err.message, "error");
    }
  });

  $("refreshPapers").addEventListener("click", loadPapers);

  /* ------------------------------------------------------------------ */
  /*  Summarize                                                          */
  /* ------------------------------------------------------------------ */
  async function loadPaperOptions() {
    const sel = $("sumPaper");
    try {
      const papers = await api.listPapers();
      if (!papers.length) { sel.innerHTML = "<option value=''>Upload a paper first</option>"; return; }
      sel.innerHTML = papers.map((p) => {
        const m = p.metadata || {};
        return `<option value="${escapeHtml(p.paper_id)}">${escapeHtml((m.title || p.paper_id).slice(0, 80))}</option>`;
      }).join("");
    } catch (e) {
      sel.innerHTML = "<option value=''>Could not load papers</option>";
    }
  }

  $("sumBtn").addEventListener("click", async () => {
    const paperId = $("sumPaper").value;
    if (!paperId) { toast("Select a paper first", "error"); return; }
    const type = $("sumType").value;
    const out = $("sumResult");
    out.innerHTML = `<div class="loading-row" style="margin-top:18px"><span class="spinner"></span> Generating ${type} summary…</div>`;
    try {
      const s = await api.summarize(paperId, type);
      let html = `<h3>${escapeHtml(s.paper_title || "Summary")}</h3><p>${escapeHtml(s.summary)}</p>`;
      if (s.key_findings && s.key_findings.length) {
        html += `<h3>Key findings</h3><ul>${s.key_findings.map((k) => `<li>${escapeHtml(k)}</li>`).join("")}</ul>`;
      }
      if (s.methodology) html += `<h3>Methodology</h3><p>${escapeHtml(s.methodology)}</p>`;
      if (s.limitations) html += `<h3>Limitations</h3><p>${escapeHtml(s.limitations)}</p>`;
      out.innerHTML = html;
    } catch (e) {
      out.innerHTML = `<div style="color:var(--danger); margin-top:16px">⚠️ ${escapeHtml(e.message)}</div>`;
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Literature review                                                  */
  /* ------------------------------------------------------------------ */
  $("revBtn").addEventListener("click", async () => {
    const topic = $("revTopic").value.trim();
    if (!topic) { toast("Enter a topic", "error"); return; }
    const out = $("revResult");
    out.innerHTML = `<div class="loading-row" style="margin-top:18px"><span class="spinner"></span> Reviewing literature… this can take a moment.</div>`;
    try {
      const r = await api.review(topic);
      let html = `<h3>Overview</h3><p>${escapeHtml(r.overview)}</p>`;
      if (r.key_themes && r.key_themes.length) html += `<h3>Key themes</h3><ul>${r.key_themes.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
      if (r.research_gaps && r.research_gaps.length) html += `<h3>Research gaps</h3><ul>${r.research_gaps.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
      if (r.future_directions && r.future_directions.length) html += `<h3>Future directions</h3><ul>${r.future_directions.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
      if (r.papers_reviewed && r.papers_reviewed.length) {
        html += `<h3>Papers reviewed (${r.num_papers})</h3><ul>` +
          r.papers_reviewed.map((p) => `<li><strong>${escapeHtml(p.title)}</strong> — ${escapeHtml(p.key_contribution || "")}</li>`).join("") + `</ul>`;
      }
      out.innerHTML = html;
    } catch (e) {
      out.innerHTML = `<div style="color:var(--danger); margin-top:16px">⚠️ ${escapeHtml(e.message)}</div>`;
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Settings modal                                                     */
  /* ------------------------------------------------------------------ */
  const modal = $("settingsModal");
  $("settingsBtn").addEventListener("click", () => {
    $("apiInput").value = cfg.API_BASE_URL;
    modal.classList.add("open");
  });
  $("settingsCancel").addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });
  $("settingsSave").addEventListener("click", () => {
    const url = $("apiInput").value.trim();
    if (!url) { toast("Enter a valid URL", "error"); return; }
    cfg.setBackend(url);
    modal.classList.remove("open");
    toast("Reconnecting to " + url, "info");
    healthTries = 0;
    checkHealth();
    loadPapers();
    loadPaperOptions();
  });

  /* ------------------------------------------------------------------ */
  /*  Init                                                               */
  /* ------------------------------------------------------------------ */
  checkHealth();
  setInterval(checkHealth, 30000);
  loadPaperOptions();
})();

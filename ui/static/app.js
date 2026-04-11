/* ── HERALD Frontend ─────────────────────────────────────────────────────── */

const CHECKPOINT_TYPES = [
  {
    value: "claim_extraction",
    label: "Claim Extraction",
    icon: "📌",
    desc: "Did the agent accurately extract a specific claim from the source — with no added details, fabricated numbers, or causal overreach?",
    valid_ex: "A direct quote or near-paraphrase of a fact in the source.",
    invalid_ex: "A claim with an added percentage, cause, or detail not in the source.",
  },
  {
    value: "numerical",
    label: "Numerical",
    icon: "🔢",
    desc: "Are all numbers, percentages, and statistics in the output exactly supported by the source?",
    valid_ex: "Output says '1.08 million units'; source says '1.078 million units'.",
    invalid_ex: "Output says '5% decline'; source says '3.2% decline'.",
  },
  {
    value: "causal",
    label: "Causal",
    icon: "🔗",
    desc: "Does the output make a causal claim that the source explicitly supports? Correlation ≠ causation.",
    valid_ex: "Source says A contributed to B; output says A was one factor in B.",
    invalid_ex: "Source shows correlation; output says A directly caused B.",
  },
  {
    value: "retrieval",
    label: "Retrieval",
    icon: "🔍",
    desc: "Was the retrieved document relevant to the query? The source context is the original query.",
    valid_ex: "Retrieved document is directly about the query topic.",
    invalid_ex: "Retrieved document is about a completely different topic.",
  },
  {
    value: "synthesis",
    label: "Synthesis",
    icon: "🧩",
    desc: "Does the synthesized output faithfully represent all input claims without distortion, omission of key caveats, or false unification?",
    valid_ex: "Output covers all claims with appropriate hedging.",
    invalid_ex: "Output drops a key caveat or merges two claims incorrectly.",
  },
];

const TIER_META = [
  {
    n: 1,
    name: "DeBERTa NLI",
    shortName: "NLI",
    icon: "🤖",
    cost: "Free · Local",
    tip: "Runs a DeBERTa-v3-large Natural Language Inference model entirely on your machine — no API calls. Maps entailment/contradiction/neutral to valid/invalid/uncertain.",
    color: "indigo",
  },
  {
    n: 2,
    name: "LLM Judge",
    shortName: "Judge",
    icon: "⚖️",
    cost: "Free API",
    tip: "A single LLM call (Groq/Gemini) that re-examines ambiguous cases with a strict validation prompt. Calibrates confidence to route borderline cases onward.",
    color: "violet",
  },
  {
    n: 3,
    name: "Multi-Agent Debate",
    shortName: "Debate",
    icon: "🗣️",
    cost: "Free API (3 calls)",
    tip: "Three agents debate the case: Advocate (argues valid), Critic (argues invalid), Judge (weighs both). Only fires on genuinely hard cases.",
    color: "purple",
  },
  {
    n: 4,
    name: "Human Review",
    shortName: "Human",
    icon: "👤",
    cost: "Your time",
    tip: "Last resort. A structured packet with all prior reasoning is queued for a human reviewer to adjudicate a specific yes/no question.",
    color: "rose",
  },
];

function heraldApp() {
  return {
    /* ── Nav ───────────────────────────────────────────────────────────── */
    tab: "validate",

    /* ── Model status ──────────────────────────────────────────────────── */
    modelStatus: "unloaded",  // unloaded | loading | ready | error
    modelError: "",
    warmupLog: "",

    /* ── Form ──────────────────────────────────────────────────────────── */
    form: {
      checkpoint_type: "claim_extraction",
      query: "",
      source_context: "",
      output_text: "",
      label: "",
    },

    /* ── Examples ──────────────────────────────────────────────────────── */
    examples: [],
    exampleIdx: 0,

    /* ── Pipeline animation state ──────────────────────────────────────── */
    isValidating: false,
    pipeline: null,
    /*
      pipeline = {
        tiers: { 1: TierState, 2: TierState, 3: TierState, 4: TierState },
        arrows: { "1->2": ArrowState, "2->3": ArrowState, "3->4": ArrowState },
        resolved_at: null | 1|2|3|4,
        final_verdict: null | 'valid'|'invalid'|'uncertain',
        log: [],
      }
      TierState = { status: 'idle'|'running'|'done'|'waiting', verdict, confidence, reasoning, scores, advocate, critic, packet, filename, expanded }
      ArrowState = 'idle' | 'flowing' | 'done'
    */

    /* ── Results ───────────────────────────────────────────────────────── */
    results: [],
    resultsFilter: "",
    expandedResult: null,

    /* ── Review queue ──────────────────────────────────────────────────── */
    queue: [],
    expandedReview: null,
    reviewNotes: "",
    submittingDecision: null,

    /* ── Metrics ───────────────────────────────────────────────────────── */
    metrics: null,
    chartsInitialized: false,

    /* ── Config ────────────────────────────────────────────────────────── */
    config: { provider: "gemini", t1_threshold: 0.70, t2_threshold: 0.80, tier2_model: "", tier3_model: "" },
    configSaving: false,
    configSaved: false,

    /* ── Static refs ───────────────────────────────────────────────────── */
    CHECKPOINT_TYPES,
    TIER_META,

    /* ── Init ──────────────────────────────────────────────────────────── */
    async init() {
      await Promise.all([
        this.fetchStatus(),
        this.fetchExamples(),
        this.fetchConfig(),
      ]);
    },

    /* ── Tab switching ─────────────────────────────────────────────────── */
    async switchTab(t) {
      this.tab = t;
      if (t === "results")  await this.fetchResults();
      if (t === "queue")    await this.fetchQueue();
      if (t === "metrics") { await this.fetchMetrics(); }
    },

    /* ── Model status & warmup ─────────────────────────────────────────── */
    async fetchStatus() {
      try {
        const r = await fetch("/api/status");
        const d = await r.json();
        this.modelStatus = d.model_status;
        this.modelError = d.model_error || "";
      } catch (_) {}
    },

    async warmup() {
      this.modelStatus = "loading";
      this.warmupLog = "Connecting…";
      try {
        const r = await fetch("/api/warmup");
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const ev of this._parseSSE(dec.decode(value))) {
            this.warmupLog = ev.message || "";
            if (ev.type === "ready")  this.modelStatus = "ready";
            if (ev.type === "error") { this.modelStatus = "error"; this.modelError = ev.message; }
          }
        }
      } catch (e) {
        this.modelStatus = "error";
        this.modelError = e.message;
      }
    },

    /* ── Examples ──────────────────────────────────────────────────────── */
    async fetchExamples() {
      try {
        const r = await fetch("/api/examples");
        this.examples = await r.json();
      } catch (_) {}
    },

    loadExample() {
      const matching = this.examples.filter(e => e.checkpoint_type === this.form.checkpoint_type);
      if (!matching.length) return;
      this.exampleIdx = (this.exampleIdx + 1) % matching.length;
      const ex = matching[this.exampleIdx];
      this.form.query = ex.query || "";
      this.form.source_context = ex.source_context || "";
      this.form.output_text = ex.output_text || "";
      this.form.label = ex.label || "";
      // Reset pipeline if loaded a new example
      this.pipeline = null;
    },

    get currentCpType() {
      return CHECKPOINT_TYPES.find(c => c.value === this.form.checkpoint_type) || CHECKPOINT_TYPES[0];
    },

    /* ── Validation ────────────────────────────────────────────────────── */
    _freshPipeline() {
      const tiers = {};
      for (let n = 1; n <= 4; n++) {
        tiers[n] = { status: n === 1 ? "idle" : "waiting", verdict: null, confidence: null, reasoning: null, scores: null, advocate: null, critic: null, packet: null, filename: null, expanded: false, message: null };
      }
      return {
        tiers,
        arrows: { "1->2": "idle", "2->3": "idle", "3->4": "idle" },
        resolved_at: null,
        final_verdict: null,
        log: [],
      };
    },

    async validate() {
      if (!this.form.output_text.trim() || !this.form.source_context.trim()) return;

      if (this.modelStatus !== "ready") {
        await this.warmup();
        if (this.modelStatus !== "ready") return;
      }

      this.isValidating = true;
      this.pipeline = this._freshPipeline();

      try {
        const r = await fetch("/api/validate/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.form),
        });

        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          // Split on double-newline (SSE event boundary)
          const parts = buf.split("\n\n");
          buf = parts.pop(); // keep incomplete tail
          for (const chunk of parts) {
            for (const ev of this._parseSSE(chunk + "\n\n")) {
              this._handleEvent(ev);
            }
          }
        }
        // Flush remaining
        for (const ev of this._parseSSE(buf)) this._handleEvent(ev);

      } catch (err) {
        console.error(err);
      } finally {
        this.isValidating = false;
      }
    },

    _handleEvent(ev) {
      if (!this.pipeline) return;
      this.pipeline.log.push(ev);

      const p = this.pipeline;

      switch (ev.type) {
        case "tier_start":
          p.tiers[ev.tier].status = "running";
          p.tiers[ev.tier].message = ev.message;
          break;

        case "tier_done":
          p.tiers[ev.tier].status = "done";
          p.tiers[ev.tier].verdict    = ev.verdict;
          p.tiers[ev.tier].confidence = ev.confidence;
          p.tiers[ev.tier].reasoning  = ev.reasoning;
          p.tiers[ev.tier].message    = ev.message;
          if (ev.raw_scores) p.tiers[ev.tier].scores   = ev.raw_scores;
          if (ev.advocate)   p.tiers[ev.tier].advocate = ev.advocate;
          if (ev.critic)     p.tiers[ev.tier].critic   = ev.critic;
          if (ev.filename)   p.tiers[ev.tier].filename  = ev.filename;
          p.tiers[ev.tier].expanded = true; // auto-expand
          break;

        case "escalating":
          p.arrows[`${ev.from_tier}->${ev.to_tier}`] = "flowing";
          // After a moment, mark done and unblock next tier
          setTimeout(() => {
            if (p.arrows[`${ev.from_tier}->${ev.to_tier}`])
              p.arrows[`${ev.from_tier}->${ev.to_tier}`] = "done";
            p.tiers[ev.to_tier].status = "idle"; // unblock from 'waiting'
          }, 800);
          break;

        case "resolved":
          p.resolved_at = ev.tier;
          p.final_verdict = ev.verdict;
          break;

        case "human_review_required":
          p.tiers[4].packet   = ev.packet;
          p.tiers[4].filename = ev.filename;
          p.resolved_at = 4;
          p.final_verdict = "uncertain";
          break;

        case "error":
          console.error("Pipeline error:", ev.message);
          break;
      }
    },

    /* ── Tier UI helpers ───────────────────────────────────────────────── */
    tierClass(n) {
      if (!this.pipeline) return "tier-idle";
      const t = this.pipeline.tiers[n];
      if (t.status === "running")  return "tier-running";
      if (t.status === "waiting")  return "tier-waiting";
      if (t.status === "done") {
        if (t.verdict === "valid")    return "tier-valid";
        if (t.verdict === "invalid")  return "tier-invalid";
        return "tier-uncertain";
      }
      return "tier-idle";
    },

    arrowClass(key) {
      if (!this.pipeline) return "arrow-idle";
      const s = this.pipeline.arrows[key];
      if (s === "flowing") return "arrow-flowing";
      if (s === "done")    return "arrow-done";
      return "arrow-idle";
    },

    verdictBadgeClass(v) {
      if (v === "valid")    return "badge-valid";
      if (v === "invalid")  return "badge-invalid";
      if (v === "uncertain") return "badge-uncertain";
      return "badge-pending";
    },

    verdictTextClass(v) {
      if (v === "valid")    return "text-green-400";
      if (v === "invalid")  return "text-red-400";
      if (v === "uncertain") return "text-amber-400";
      return "text-slate-400";
    },

    confBarClass(c) {
      if (c >= 0.80) return "bg-green-500";
      if (c >= 0.60) return "bg-amber-500";
      return "bg-red-500";
    },

    pct(v) { return Math.round((v || 0) * 100); },

    /* ── Results ───────────────────────────────────────────────────────── */
    async fetchResults() {
      const r = await fetch("/api/results");
      this.results = (await r.json()).reverse(); // newest first
    },

    filteredResults() {
      if (!this.resultsFilter) return this.results;
      return this.results.filter(r => r.checkpoint_type === this.resultsFilter);
    },

    async clearResults() {
      if (!confirm("Clear all results? This cannot be undone.")) return;
      await fetch("/api/results", { method: "DELETE" });
      this.results = [];
    },

    toggleResult(idx) {
      this.expandedResult = this.expandedResult === idx ? null : idx;
    },

    /* ── Review queue ──────────────────────────────────────────────────── */
    async fetchQueue() {
      const r = await fetch("/api/review-queue");
      this.queue = await r.json();
    },

    get pendingQueue() { return this.queue.filter(q => !q.decided); },
    get decidedQueue() { return this.queue.filter(q => q.decided); },

    toggleReview(filename) {
      this.expandedReview = this.expandedReview === filename ? null : filename;
      this.reviewNotes = "";
    },

    async submitDecision(filename, verdict) {
      this.submittingDecision = filename + verdict;
      await fetch(`/api/review-queue/${filename}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict, notes: this.reviewNotes }),
      });
      this.submittingDecision = null;
      this.expandedReview = null;
      await this.fetchQueue();
    },

    /* ── Metrics ───────────────────────────────────────────────────────── */
    async fetchMetrics() {
      const r = await fetch("/api/metrics");
      this.metrics = await r.json();
      if (this.metrics.total > 0) {
        // Wait for DOM, then draw charts
        setTimeout(() => this._drawCharts(), 50);
      }
    },

    _drawCharts() {
      if (typeof Chart === "undefined") return;

      // Destroy existing charts
      ["verdictChart", "tierChart", "typeChart"].forEach(id => {
        const canvas = document.getElementById(id);
        if (canvas && canvas._chart) { canvas._chart.destroy(); canvas._chart = null; }
      });

      const m = this.metrics;
      const COLORS = { valid: "#22c55e", invalid: "#ef4444", uncertain: "#f59e0b" };
      const TIER_COLORS = ["#6366f1", "#8b5cf6", "#a855f7", "#ec4899"];
      const baseOpts = {
        responsive: true,
        plugins: { legend: { labels: { color: "#94a3b8" } } },
      };

      // Verdict donut
      const vc = document.getElementById("verdictChart");
      if (vc && m.verdicts) {
        const labels = Object.keys(m.verdicts);
        vc._chart = new Chart(vc, {
          type: "doughnut",
          data: {
            labels,
            datasets: [{ data: labels.map(l => m.verdicts[l]), backgroundColor: labels.map(l => COLORS[l] || "#64748b"), borderWidth: 0 }],
          },
          options: { ...baseOpts, cutout: "60%" },
        });
      }

      // Tier escalation bar
      const tc = document.getElementById("tierChart");
      if (tc && m.tiers) {
        const tLabels = ["1","2","3","4"].filter(k => m.tiers[k]);
        tc._chart = new Chart(tc, {
          type: "bar",
          data: {
            labels: tLabels.map(k => `Tier ${k}`),
            datasets: [{
              label: "Cases resolved",
              data: tLabels.map(k => m.tiers[k] || 0),
              backgroundColor: TIER_COLORS,
              borderRadius: 4,
            }],
          },
          options: {
            ...baseOpts,
            scales: {
              x: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } },
              y: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } },
            },
          },
        });
      }

      // By-type bar
      const byc = document.getElementById("typeChart");
      if (byc && m.by_type) {
        const types = Object.keys(m.by_type);
        byc._chart = new Chart(byc, {
          type: "bar",
          data: {
            labels: types.map(t => t.replace("_", " ")),
            datasets: [
              { label: "Valid",     data: types.map(t => m.by_type[t].valid     || 0), backgroundColor: "#22c55e", borderRadius: 4 },
              { label: "Invalid",   data: types.map(t => m.by_type[t].invalid   || 0), backgroundColor: "#ef4444", borderRadius: 4 },
              { label: "Uncertain", data: types.map(t => m.by_type[t].uncertain || 0), backgroundColor: "#f59e0b", borderRadius: 4 },
            ],
          },
          options: {
            ...baseOpts,
            scales: {
              x: { stacked: true, ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } },
              y: { stacked: true, ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } },
            },
          },
        });
      }
    },

    /* ── Config ────────────────────────────────────────────────────────── */
    async fetchConfig() {
      try {
        const r = await fetch("/api/config");
        this.config = await r.json();
      } catch (_) {}
    },

    async saveConfig() {
      this.configSaving = true;
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          t1_threshold: parseFloat(this.config.t1_threshold),
          t2_threshold: parseFloat(this.config.t2_threshold),
          provider: this.config.provider,
        }),
      });
      this.configSaving = false;
      this.configSaved = true;
      setTimeout(() => { this.configSaved = false; }, 2500);
    },

    /* ── Utility ───────────────────────────────────────────────────────── */
    _parseSSE(text) {
      return text.split("\n")
        .filter(l => l.startsWith("data: "))
        .map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
        .filter(Boolean);
    },

    fmt(ts) {
      if (!ts) return "";
      return new Date(ts).toLocaleString();
    },

    truncate(s, n = 80) {
      if (!s) return "";
      return s.length > n ? s.slice(0, n) + "…" : s;
    },
  };
}

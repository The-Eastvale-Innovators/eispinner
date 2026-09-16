/* ============================================================
   PRIZE ARCADE — spinner engine
   ============================================================ */
(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const POINTER_ANGLE = -Math.PI / 2; // top of the wheel (12 o'clock)
  const STORE_KEY = "prize-arcade-v1";

  // Curated arcade palette — vivid, high separation.
  const PALETTE = [
    "#ff3ea5", "#22e1ff", "#ffe14d", "#4dffb8", "#a45cff",
    "#ff8a3d", "#3d9bff", "#ff5c7c", "#7cff5c", "#ff4de1",
    "#4dd2ff", "#ffd24d", "#b0ff4d", "#c04dff", "#ff6b4d",
  ];

  // ---- State ----
  let entries = [];
  let weighted = false;
  let soundOn = true;
  let rotation = 0;          // current wheel rotation (radians)
  let spinning = false;
  let lastTickSegment = -1;

  // ---- DOM ----
  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");
  const wheelHolder = document.getElementById("wheelHolder");
  const spinBtn = document.getElementById("spinBtn");
  const hubLabel = document.getElementById("hubLabel");
  const pointer = document.getElementById("pointer");
  const entriesEl = document.getElementById("entries");
  const addForm = document.getElementById("addForm");
  const addInput = document.getElementById("addInput");
  const weightToggle = document.getElementById("weightToggle");
  const shuffleBtn = document.getElementById("shuffleBtn");
  const clearBtn = document.getElementById("clearBtn");
  const soundBtn = document.getElementById("soundBtn");
  const resultValue = document.getElementById("resultValue");
  const chipCount = document.getElementById("chipCount");
  const chipMode = document.getElementById("chipMode");
  const winModal = document.getElementById("winModal");
  const modalPrize = document.getElementById("modalPrize");
  const againBtn = document.getElementById("againBtn");
  const removeWinnerBtn = document.getElementById("removeWinnerBtn");
  const closeModalBtn = document.getElementById("closeModalBtn");

  // ---- Utils ----
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const norm = (a) => ((a % TAU) + TAU) % TAU;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3.4);

  function pickColor() {
    const used = new Set(entries.map((e) => e.color));
    const free = PALETTE.find((c) => !used.has(c));
    return free || PALETTE[Math.floor(Math.random() * PALETTE.length)];
  }

  // ---- Persistence ----
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ entries, weighted, soundOn }));
    } catch (_) { /* ignore quota / privacy mode */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        entries = Array.isArray(d.entries) ? d.entries : [];
        weighted = !!d.weighted;
        soundOn = d.soundOn !== false;
        return true;
      }
    } catch (_) { /* fall through to seed */ }
    return false;
  }

  // ---- Sound ----
  let audioCtx = null;
  function audio() {
    if (!soundOn) return null;
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function blip(freq, dur = 0.05, type = "square", gain = 0.05) {
    const ac = audio();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.connect(g).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  }
  function tickSound() { blip(880 + Math.random() * 120, 0.04, "square", 0.035); }
  function winSound() {
    const notes = [523, 659, 784, 1046, 1318];
    notes.forEach((f, i) => setTimeout(() => blip(f, 0.18, "triangle", 0.07), i * 90));
  }

  // ---- Weights ----
  function totalWeight() {
    return entries.reduce((s, e) => s + (weighted ? Math.max(0.0001, e.weight) : 1), 0);
  }
  function segAngle(e) {
    const w = weighted ? Math.max(0.0001, e.weight) : 1;
    return (w / totalWeight()) * TAU;
  }

  // ---- Wheel rendering ----
  let dpr = Math.max(1, window.devicePixelRatio || 1);

  function resizeCanvas() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    const size = wheelHolder.clientWidth - 28; // minus padding
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    drawWheel();
  }

  function drawWheel() {
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2, r = Math.min(cx, cy) - 2;
    ctx.clearRect(0, 0, w, h);

    if (entries.length === 0) {
      ctx.save();
      ctx.fillStyle = "#0b0920";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      ctx.fillStyle = "#4a5488";
      ctx.font = `${Math.round(r * 0.09)}px Orbitron, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("ADD PRIZES", cx, cy);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    let a = 0;
    const n = entries.length;
    for (let i = 0; i < n; i++) {
      const e = entries[i];
      const span = segAngle(e);
      const a0 = a, a1 = a + span;

      // Slice with subtle radial shading
      const grad = ctx.createRadialGradient(0, 0, r * 0.12, 0, 0, r);
      grad.addColorStop(0, shade(e.color, 0.22));
      grad.addColorStop(1, e.color);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, a0, a1);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Divider
      ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.lineWidth = Math.max(1, r * 0.006);
      ctx.stroke();

      // Label
      drawLabel(e.name, a0 + span / 2, r, span, n);
      a = a1;
    }

    // Inner ring accent
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.995, 0, TAU);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = Math.max(1.5, r * 0.01);
    ctx.stroke();

    ctx.restore();
  }

  function drawLabel(text, mid, r, span, n) {
    ctx.save();
    ctx.rotate(mid);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    // Font scales down with more slots / thinner slices.
    let fs = clamp(r * 0.075, 11 * dpr, r * 0.11);
    if (span < 0.18) fs *= 0.8;
    ctx.font = `700 ${Math.round(fs)}px Rajdhani, sans-serif`;
    // Truncate very long labels.
    const maxChars = span < 0.25 ? 12 : 20;
    let label = text.length > maxChars ? text.slice(0, maxChars - 1) + "…" : text;
    ctx.fillStyle = readable(text);
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 3 * dpr;
    ctx.fillText(label, r * 0.9, 0);
    ctx.restore();
  }

  // Lighten a hex color by amount 0..1 (toward white).
  function shade(hex, amt) {
    const { r, g, b } = hexRGB(hex);
    const mix = (c) => Math.round(c + (255 - c) * amt);
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  }
  function hexRGB(hex) {
    const h = hex.replace("#", "");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  // Choose dark or light text for contrast.
  function readable(refHexForColor) { return "#0a0a1f"; }

  // ---- Winner detection ----
  function winnerAt(rot) {
    const local = norm(POINTER_ANGLE - rot);
    let a = 0;
    for (let i = 0; i < entries.length; i++) {
      const span = segAngle(entries[i]);
      if (local >= a && local < a + span) return i;
      a += span;
    }
    return entries.length - 1;
  }

  // ---- Spin ----
  function spin() {
    if (spinning || entries.length === 0) return;
    if (entries.length === 1) { celebrate(0); return; }

    spinning = true;
    spinBtn.disabled = true;
    spinBtn.classList.add("spinning");
    hubLabel.textContent = "···";
    winModalClose();

    audio(); // unlock on gesture

    const start = rotation;
    const turns = 5 + Math.floor(Math.random() * 4); // 5–8 full turns
    const extra = Math.random() * TAU;
    const target = start + turns * TAU + extra;
    const duration = 5200 + Math.random() * 900;
    const startTime = performance.now();
    lastTickSegment = winnerAt(start);

    function frame(now) {
      const t = clamp((now - startTime) / duration, 0, 1);
      rotation = start + (target - start) * easeOut(t);
      drawWheel();

      // Tick + pointer flap when a new slice reaches the pointer.
      const seg = winnerAt(rotation);
      if (seg !== lastTickSegment) {
        lastTickSegment = seg;
        tickSound();
        pointer.classList.remove("tick");
        void pointer.offsetWidth;
        pointer.classList.add("tick");
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        rotation = norm(target);
        drawWheel();
        spinning = false;
        spinBtn.disabled = false;
        spinBtn.classList.remove("spinning");
        hubLabel.textContent = "SPIN";
        celebrate(winnerAt(rotation));
      }
    }
    requestAnimationFrame(frame);
  }

  function celebrate(index) {
    const e = entries[index];
    if (!e) return;
    resultValue.textContent = e.name;
    modalPrize.textContent = e.name;
    modalPrize.style.textShadow = `0 0 20px ${e.color}, 0 0 44px ${e.color}88`;
    winModal._winnerId = e.id;
    winSound();
    openModal();
    flashEntry(e.id);
  }

  // ---- Entries UI ----
  function renderEntries() {
    entriesEl.classList.toggle("weighted", weighted);
    entriesEl.innerHTML = "";

    if (entries.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.innerHTML = "No prizes yet.<br>Add your first prize below to load the wheel.";
      entriesEl.appendChild(hint);
    }

    const tw = totalWeight();
    entries.forEach((e) => {
      const row = document.createElement("div");
      row.className = "entry";
      row.dataset.id = e.id;
      row.setAttribute("role", "listitem");

      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = e.color;
      swatch.style.color = e.color;
      swatch.title = "Click to recolor";
      swatch.addEventListener("click", () => {
        const idx = PALETTE.indexOf(e.color);
        e.color = PALETTE[(idx + 1 + Math.floor(Math.random() * (PALETTE.length - 1))) % PALETTE.length];
        swatch.style.background = e.color; swatch.style.color = e.color;
        drawWheel(); save();
      });

      const name = document.createElement("input");
      name.className = "entry-name";
      name.value = e.name;
      name.maxLength = 42;
      name.setAttribute("aria-label", "Prize name");
      name.addEventListener("input", () => { e.name = name.value; drawWheel(); });
      name.addEventListener("change", save);

      const weight = document.createElement("input");
      weight.className = "weight-input";
      weight.type = "number";
      weight.min = "1"; weight.step = "1";
      weight.value = e.weight;
      weight.setAttribute("aria-label", "Weight");
      weight.addEventListener("input", () => {
        e.weight = clamp(parseFloat(weight.value) || 1, 0.1, 9999);
        drawWheel(); updatePercents();
      });
      weight.addEventListener("change", save);

      const pct = document.createElement("span");
      pct.className = "pct";
      const share = (weighted ? Math.max(0.0001, e.weight) : 1) / tw;
      pct.textContent = Math.round(share * 100) + "%";

      const del = document.createElement("button");
      del.className = "del-btn";
      del.innerHTML = "×";
      del.title = "Remove";
      del.setAttribute("aria-label", "Remove prize");
      del.addEventListener("click", () => removeEntry(e.id));

      row.append(swatch, name, weight, pct, del);
      entriesEl.appendChild(row);
    });

    updateMeta();
  }

  function updatePercents() {
    const tw = totalWeight();
    entriesEl.querySelectorAll(".entry").forEach((row) => {
      const e = entries.find((x) => x.id === row.dataset.id);
      if (!e) return;
      const share = (weighted ? Math.max(0.0001, e.weight) : 1) / tw;
      const pct = row.querySelector(".pct");
      if (pct) pct.textContent = Math.round(share * 100) + "%";
    });
    save();
  }

  function updateMeta() {
    chipCount.textContent = entries.length + (entries.length === 1 ? " SLOT" : " SLOTS");
    chipMode.textContent = weighted ? "WEIGHTED" : "EVEN ODDS";
  }

  function addEntry(name) {
    const clean = name.trim();
    if (!clean) return;
    entries.push({ id: uid(), name: clean, weight: 1, color: pickColor() });
    renderEntries();
    drawWheel();
    save();
    blip(660, 0.05, "square", 0.04);
  }

  function removeEntry(id) {
    const row = entriesEl.querySelector(`.entry[data-id="${id}"]`);
    const finish = () => {
      entries = entries.filter((e) => e.id !== id);
      renderEntries(); drawWheel(); save();
    };
    if (row) {
      row.classList.add("leaving");
      setTimeout(finish, 220);
    } else finish();
    blip(320, 0.06, "sawtooth", 0.03);
  }

  function flashEntry(id) {
    const row = entriesEl.querySelector(`.entry[data-id="${id}"]`);
    if (row) {
      row.classList.remove("winner-flash");
      void row.offsetWidth;
      row.classList.add("winner-flash");
    }
  }

  // ---- Modal ----
  function openModal() { winModal.classList.add("open"); winModal.setAttribute("aria-hidden", "false"); startConfetti(); }
  function winModalClose() {
    winModal.classList.remove("open");
    winModal.setAttribute("aria-hidden", "true");
    stopConfetti();
  }

  // ---- Confetti ----
  const confettiCanvas = document.getElementById("confetti");
  const cctx = confettiCanvas.getContext("2d");
  let confParticles = [];
  let confRAF = null;

  function startConfetti() {
    confettiCanvas.width = confettiCanvas.clientWidth * dpr;
    confettiCanvas.height = confettiCanvas.clientHeight * dpr;
    confParticles = [];
    const count = 160;
    for (let i = 0; i < count; i++) {
      confParticles.push({
        x: Math.random() * confettiCanvas.width,
        y: -Math.random() * confettiCanvas.height * 0.5,
        vx: (Math.random() - 0.5) * 3 * dpr,
        vy: (2 + Math.random() * 4) * dpr,
        size: (5 + Math.random() * 7) * dpr,
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 0.3,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        shape: Math.random() > 0.5 ? "rect" : "circ",
      });
    }
    if (confRAF) cancelAnimationFrame(confRAF);
    confLoop();
  }
  function confLoop() {
    cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    let alive = 0;
    for (const p of confParticles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05 * dpr; p.rot += p.vr;
      if (p.y < confettiCanvas.height + 40) alive++;
      cctx.save();
      cctx.translate(p.x, p.y); cctx.rotate(p.rot);
      cctx.fillStyle = p.color;
      cctx.globalAlpha = 0.9;
      if (p.shape === "rect") cctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      else { cctx.beginPath(); cctx.arc(0, 0, p.size / 2, 0, TAU); cctx.fill(); }
      cctx.restore();
    }
    if (alive > 0 && winModal.classList.contains("open")) {
      confRAF = requestAnimationFrame(confLoop);
    } else {
      cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
  }
  function stopConfetti() { if (confRAF) cancelAnimationFrame(confRAF); confRAF = null; }

  // ---- Events ----
  spinBtn.addEventListener("click", spin);

  addForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    addEntry(addInput.value);
    addInput.value = "";
    addInput.focus();
  });

  weightToggle.addEventListener("change", () => {
    weighted = weightToggle.checked;
    renderEntries(); drawWheel(); save();
    blip(weighted ? 740 : 500, 0.06, "square", 0.04);
  });

  shuffleBtn.addEventListener("click", () => {
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    renderEntries(); drawWheel(); save();
    blip(600, 0.06, "square", 0.04);
  });

  clearBtn.addEventListener("click", () => {
    if (entries.length === 0) return;
    if (!confirm("Remove all prizes from the wheel?")) return;
    entries = [];
    renderEntries(); drawWheel(); save();
    resultValue.textContent = "Insert prizes to begin";
  });

  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? "🔊 SFX ON" : "🔇 SFX OFF";
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    save();
    if (soundOn) blip(700, 0.08, "square", 0.05);
  });

  againBtn.addEventListener("click", () => { winModalClose(); setTimeout(spin, 220); });
  removeWinnerBtn.addEventListener("click", () => {
    const id = winModal._winnerId;
    winModalClose();
    if (id) removeEntry(id);
    setTimeout(() => { if (entries.length > 0) spin(); }, 320);
  });
  closeModalBtn.addEventListener("click", winModalClose);
  winModal.addEventListener("click", (e) => { if (e.target === winModal) winModalClose(); });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement.tagName !== "INPUT" && !winModal.classList.contains("open")) {
      e.preventDefault(); spin();
    }
    if (e.key === "Escape") winModalClose();
  });

  let resizeTO = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(resizeCanvas, 100);
  });

  // ---- Init ----
  function init() {
    if (!load()) {
      entries = ["1st Place", "2nd Place", "Free Spin", "Try Again", "Jackpot", "Mystery Box"]
        .map((name, i) => ({ id: uid(), name, weight: 1, color: PALETTE[i % PALETTE.length] }));
    }
    weightToggle.checked = weighted;
    soundBtn.textContent = soundOn ? "🔊 SFX ON" : "🔇 SFX OFF";
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    renderEntries();
    resizeCanvas();
  }

  // Wait for fonts so labels render crisp, but don't block forever.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(drawWheel);
  }
  init();
})();

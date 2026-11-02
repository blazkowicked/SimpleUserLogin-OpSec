// Home: account summary, signed-in devices preview and the authentication-route visual
(() => {
  if (!window.OpSec) return;
  const { api, renderDevices } = window.OpSec;
  const canvas = document.getElementById("routeCanvas");
  let youLabel = "this device";

  api("/api/auth/sessions")
    .then(({ sessions }) => {
      const current = sessions.find((s) => s.current);
      const others = sessions.length - (current ? 1 : 0);
      if (current) youLabel = current.device;
      document.getElementById("thisDevice").textContent = current ? current.device : "Unknown";
      document.getElementById("otherDevices").textContent = others === 0 ? "None" : `${others} signed in`;
      renderDevices(document.getElementById("devicePreview"), sessions.slice(0, 3));
      draw();
    })
    .catch(() => {});

  // ---------- authentication route ----------
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const ACCENT = "61, 220, 132";
  const STEPS = [["You", () => youLabel], ["Password checked", () => "bcrypt match"], ["Email code verified", () => "6-digit code"], ["Session issued", () => "signed token"]];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let W = 0, H = 0, dpr = 1, net = null, route = [], labels = [], start = performance.now(), raf = 0;

  function rng(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function build() {
    const r = rng(1337), step = W / 8.5, pts = [];
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        const px = x + (r() - 0.5) * step * 0.8, py = y + (r() - 0.5) * step * 0.8;
        const inside = Math.hypot((px - W * 0.52) / (W * 0.52), (py - H * 0.5) / (H * 0.52)) < 1;
        if (inside && r() < 0.92) pts.push({ x: px, y: py, big: r() < 0.08 });
      }
    }
    const adj = pts.map(() => []);
    const edges = new Set();
    pts.forEach((p, i) => {
      pts.map((q, j) => ({ j, d: Math.hypot(p.x - q.x, p.y - q.y) }))
        .filter((o) => o.j !== i && o.d < step * 1.75)
        .sort((a, b) => a.d - b.d)
        .slice(0, 4)
        .forEach((o) => edges.add(i < o.j ? `${i}-${o.j}` : `${o.j}-${i}`));
    });
    const edgeList = [...edges].map((e) => e.split("-").map(Number));
    for (const [a, b] of edgeList) {
      const d = Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
      adj[a].push([b, d]);
      adj[b].push([a, d]);
    }
    const near = (x, y) => pts.reduce((bi, p, i) => (Math.hypot(p.x - x, p.y - y) < Math.hypot(pts[bi].x - x, pts[bi].y - y) ? i : bi), 0);
    const s = near(W * 0.1, H * 0.84), e = near(W * 0.86, H * 0.16);
    const dist = pts.map(() => Infinity), prev = pts.map(() => -1), done = new Set();
    dist[s] = 0;
    while (done.size < pts.length) {
      let u = -1;
      for (let i = 0; i < pts.length; i++) if (!done.has(i) && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      done.add(u);
      if (u === e) break;
      for (const [v, d] of adj[u]) if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; prev[v] = u; }
    }
    const path = [];
    for (let v = e; v !== -1; v = prev[v]) path.unshift(v);
    net = { pts, edges: edgeList };
    route = path.map((i) => pts[i]);
  }

  function placeLabels() {
    labels = [];
    if (route.length < 2) return;
    const idx = [0, Math.round((route.length - 1) / 3), Math.round((2 * (route.length - 1)) / 3), route.length - 1];
    const nodes = idx.map((i) => route[i]);
    const placed = [];
    const hit = (a, b) => a.x < b.x + b.w + 6 && b.x < a.x + a.w + 6 && a.y < b.y + b.h + 6 && b.y < a.y + a.h + 6;
    const coversNode = (b) => nodes.some((n) => n.x > b.x - 10 && n.x < b.x + b.w + 10 && n.y > b.y - 10 && n.y < b.y + b.h + 10);
    // Place the ends first (they sit near the edges), then the middle steps
    for (const k of [3, 0, 1, 2]) {
      const [title, detail] = STEPS[k];
      const p = nodes[k];
      ctx.font = '500 11px "JetBrains Mono", monospace';
      const w1 = ctx.measureText(title).width;
      ctx.font = '400 10px "JetBrains Mono", monospace';
      const w2 = ctx.measureText(detail()).width;
      const compact = W < 480;
      const w = Math.ceil(compact ? w1 : Math.max(w1, w2)) + 16, h = compact ? 22 : 36;
      const cands = [];
      for (const dy of [-h - 10, 12, -h / 2, -h - 40, 42, -h - 70, 72]) for (const dx of [16, -16 - w, -w / 2, 40, -40 - w]) cands.push([p.x + dx, p.y + dy]);
      let box = null, fallback = null;
      for (const [x, y] of cands) {
        const b = { x, y, w, h };
        if (x < 0 || y < 0 || x + w > W || y + h > H || placed.some((o) => hit(b, o))) continue;
        if (!fallback) fallback = b;
        if (!coversNode(b)) { box = b; break; }
      }
      box = box || fallback || { x: Math.min(Math.max(p.x + 16, 0), W - w), y: Math.max(p.y - h - 10, 0), w, h };
      placed.push(box);
      labels.push({ ...box, title, detail, compact });
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function render(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    for (const [a, b] of net.edges) {
      ctx.moveTo(net.pts[a].x, net.pts[a].y);
      ctx.lineTo(net.pts[b].x, net.pts[b].y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const p of net.pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.big ? 4.5 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = p.big ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.75)";
      ctx.fill();
    }
    if (route.length > 1) {
      ctx.beginPath();
      route.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = `rgb(${ACCENT})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = `rgb(${ACCENT})`;
      route.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === 0 || i === route.length - 1 ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      });
      const end = route[route.length - 1], first = route[0];
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(end.x, end.y, 14, 0, Math.PI * 2); ctx.strokeStyle = `rgba(${ACCENT},0.45)`; ctx.stroke();
      ctx.beginPath(); ctx.arc(first.x, first.y, 11, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.stroke();
      // a packet travels the route, then rests
      if (t !== null) {
        const phase = (t % 6) / 3;
        if (phase <= 1) {
          const lens = [];
          let total = 0;
          for (let i = 1; i < route.length; i++) { const l = Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y); lens.push(l); total += l; }
          let d = (1 - Math.pow(1 - phase, 3)) * total, i = 0;
          while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i++; }
          const f = lens[i] ? d / lens[i] : 0;
          ctx.beginPath();
          ctx.arc(route[i].x + (route[i + 1].x - route[i].x) * f, route[i].y + (route[i + 1].y - route[i].y) * f, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        }
      }
    }
    for (const l of labels) {
      roundRect(l.x, l.y, l.w, l.h, 4);
      ctx.fillStyle = "rgba(10,11,14,0.88)";
      ctx.fill();
      ctx.strokeStyle = "#2c323a";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textBaseline = "top";
      ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.fillStyle = "#f2f4f7";
      ctx.fillText(l.title, l.x + 8, l.y + 5);
      if (l.compact) continue;
      ctx.font = '400 10px "JetBrains Mono", monospace';
      ctx.fillStyle = "#8a929d";
      ctx.fillText(l.detail(), l.x + 8, l.y + 20);
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    render((now - start) / 1000);
  }

  function draw() {
    cancelAnimationFrame(raf);
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    build();
    placeLabels();
    if (reduce.matches || document.hidden) render(null);
    else raf = requestAnimationFrame(frame);
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(draw, 150);
  });
  document.addEventListener("visibilitychange", draw);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  draw();
})();

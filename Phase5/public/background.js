// Animated polygon-network background for the redesigned pages.
// Draws onto <canvas class="bg-network">. Purely decorative: no network calls, no user data.
(() => {
  const canvas = document.querySelector("canvas.bg-network");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");

  // Layout is designed on a 1280 x 800 frame (same as the Figma file).
  const DESIGN_W = 1280;
  const DESIGN_H = 800;

  function rng(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Jittered grid of points, each joined to its nearest neighbours.
  function makeNet(seed, x0, x1, y0, y1, step, keep, k, maxD) {
    const r = rng(seed);
    const pts = [];
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        const px = x + (r() - 0.5) * step * 0.8;
        const py = y + (r() - 0.5) * step * 0.8;
        if (keep(px, py, r)) pts.push({ x: px, y: py, big: r() < 0.1 });
      }
    }
    // Each node wanders on its own: a random push that changes smoothly over time,
    // a soft pull back toward its home spot, and friction. No snaps, no repeating loops.
    for (const p of pts) {
      p.ox = 0; p.oy = 0; // offset from home (design px)
      p.vx = 0; p.vy = 0; // velocity
      p.fx = 0; p.fy = 0; // current random push
    }
    const edges = new Set();
    pts.forEach((p, i) => {
      pts
        .map((q, j) => ({ j, d: Math.hypot(p.x - q.x, p.y - q.y) }))
        .filter((o) => o.j !== i && o.d < maxD)
        .sort((a, b) => a.d - b.d)
        .slice(0, k)
        .forEach((o) => edges.add(i < o.j ? `${i}-${o.j}` : `${o.j}-${i}`));
    });
    return { pts, edges: [...edges].map((e) => e.split("-").map(Number)) };
  }

  const dim = makeNet(7, -60, 560, 120, 900, 88, (x, y, r) => x < 540 - (y < 300 ? 300 - y : 0) && r() < 0.9, 4, 150);
  const bright = makeNet(42, 560, 1360, 160, 900, 84, (x, y) => (x - 560) / 760 + (y - 160) / 700 > 0.78, 4, 150);

  // Shortest path through the bright network: the green "authenticated route".
  function shortestPath(net, from, to) {
    const n = net.pts.length;
    const adj = Array.from({ length: n }, () => []);
    for (const [a, b] of net.edges) {
      const d = Math.hypot(net.pts[a].x - net.pts[b].x, net.pts[a].y - net.pts[b].y);
      adj[a].push([b, d]);
      adj[b].push([a, d]);
    }
    const nearest = (x, y) =>
      net.pts.reduce((bi, p, i) => (Math.hypot(p.x - x, p.y - y) < Math.hypot(net.pts[bi].x - x, net.pts[bi].y - y) ? i : bi), 0);
    const s = nearest(from[0], from[1]);
    const e = nearest(to[0], to[1]);
    const dist = new Array(n).fill(Infinity);
    const prev = new Array(n).fill(-1);
    const done = new Set();
    dist[s] = 0;
    while (done.size < n) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done.has(i) && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      done.add(u);
      if (u === e) break;
      for (const [v, d] of adj[u]) if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; prev[v] = u; }
    }
    const route = [];
    for (let v = e; v !== -1; v = prev[v]) route.unshift(v);
    return route;
  }
  const route = shortestPath(bright, [880, 600], [1200, 300]);

  // ---- sizing ----
  let W = 0, H = 0, scale = 1, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    scale = Math.max(W / DESIGN_W, H / DESIGN_H);
  }
  // Dim net hugs the bottom-left corner, bright net the bottom-right corner.
  const mapLeft = (x, y) => [x * scale, H - (DESIGN_H - y) * scale];
  const mapRight = (x, y) => [W - (DESIGN_W - x) * scale, H - (DESIGN_H - y) * scale];

  const PUSH = 25; // strength of the random push (bigger = wanders further and faster)
  const PUSH_TIME = 1.2; // seconds a push direction tends to last (bigger = smoother, lazier turns)
  const PULL = 1; // pull back toward home (bigger = stays closer)
  const FRICTION = 2.5; // damping on velocity (bigger = calmer)

  // Standard normal random number
  function gauss() {
    let u = 0;
    while (u === 0) u = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  }

  function positions(net, map, dt) {
    const kick = PUSH * Math.sqrt(dt);
    return net.pts.map((p) => {
      if (dt > 0) {
        p.fx += (-p.fx / PUSH_TIME) * dt + kick * gauss();
        p.fy += (-p.fy / PUSH_TIME) * dt + kick * gauss();
        p.vx += (p.fx - PULL * p.ox - FRICTION * p.vx) * dt;
        p.vy += (p.fy - PULL * p.oy - FRICTION * p.vy) * dt;
        p.ox += p.vx * dt;
        p.oy += p.vy * dt;
      }
      return map(p.x + p.ox, p.y + p.oy);
    });
  }

  function drawNet(net, pos, stroke, lineWidth, fill, rSmall, rBig) {
    ctx.beginPath();
    for (const [a, b] of net.edges) {
      ctx.moveTo(pos[a][0], pos[a][1]);
      ctx.lineTo(pos[b][0], pos[b][1]);
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.fillStyle = fill;
    net.pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(pos[i][0], pos[i][1], p.big ? rBig : rSmall, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  const ACCENT = "61, 220, 132"; // #3ddc84
  const CYCLE = 5; // seconds per packet trip, including the pause at the end
  const TRAVEL = 3.2;

  function drawRoute(pos, t, animate) {
    const pts = route.map((i) => pos[i]);
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.strokeStyle = `rgba(${ACCENT}, 0.9)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = `rgb(${ACCENT})`;
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p[0], p[1], i === pts.length - 1 ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    });
    const end = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(end[0], end[1], 10, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${ACCENT}, 0.45)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (!animate) return;
    // A single packet travels the route, then rests at the end node.
    const phase = (t % CYCLE) / TRAVEL;
    if (phase > 1) return;
    const lens = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lens.push(l);
      total += l;
    }
    const eased = 1 - Math.pow(1 - phase, 3);
    let d = eased * total;
    let i = 0;
    while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i++; }
    const f = lens[i] ? d / lens[i] : 0;
    const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
    const y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  function draw(t, animate, dt = 0) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawNet(dim, positions(dim, mapLeft, dt), "#2e333a", 1, "#2e333a", 2.5, 5);
    // data-nets="dim" (Home) keeps only the faint network; the page draws its own route visual
    if (canvas.dataset.nets === "dim") return;
    const bpos = positions(bright, mapRight, dt);
    drawNet(bright, bpos, "rgba(255, 255, 255, 0.55)", 1.2, "#ffffff", 2.5, 6);
    drawRoute(bpos, t, animate);
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let raf = 0;
  let last = 0;
  let start = performance.now();

  // ---- carry the animation across page loads ----
  // Each page is a separate HTML file, so the canvas restarts on navigation. Before leaving a page we
  // save the clock and each node's motion state to sessionStorage; the next page picks up from there.
  // Only animation numbers are stored, nothing about the user.
  const STATE_KEY = "opsec-bg-state-v2";
  const MOTION_FIELDS = ["ox", "oy", "vx", "vy", "fx", "fy"];

  function saveState() {
    try {
      const pack = (net) => net.pts.map((p) => MOTION_FIELDS.map((f) => Math.round(p[f] * 100) / 100));
      sessionStorage.setItem(
        STATE_KEY,
        JSON.stringify({ t: (performance.now() - start) / 1000, at: Date.now(), dim: pack(dim), bright: pack(bright) }),
      );
    } catch (_) {
      /* storage blocked: next page just starts fresh */
    }
  }

  function restoreState() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || "null");
      if (!saved || typeof saved.t !== "number") return;
      const gap = Math.min(Math.max((Date.now() - saved.at) / 1000, 0), 5); // time spent loading the new page
      const unpack = (net, rows) => {
        if (!Array.isArray(rows) || rows.length !== net.pts.length) return;
        net.pts.forEach((p, i) => {
          if (!Array.isArray(rows[i]) || rows[i].length !== MOTION_FIELDS.length) return;
          MOTION_FIELDS.forEach((f, j) => { if (Number.isFinite(rows[i][j])) p[f] = rows[i][j]; });
        });
      };
      unpack(dim, saved.dim);
      unpack(bright, saved.bright);
      start = performance.now() - (saved.t + gap) * 1000;
    } catch (_) {
      /* bad or missing state: start fresh */
    }
  }

  restoreState();
  window.addEventListener("pagehide", saveState);

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / 30) return; // cap at ~30 fps
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0; // clamp so a stalled tab doesn't fling nodes
    last = now;
    draw((now - start) / 1000, true, dt);
  }

  function run() {
    cancelAnimationFrame(raf);
    raf = 0;
    resize();
    if (reduceMotion.matches || document.hidden) {
      draw(reduceMotion.matches ? 0 : (performance.now() - start) / 1000, false); // static frame
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener("resize", run);
  document.addEventListener("visibilitychange", run);
  if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", run);
  run();
})();

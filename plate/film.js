(() => {
  const FRAME_COUNT = 344;
  const BG = '#eeedf1';
  // Where the bowl sits in the footage (fractions of frame width/height).
  const FOCUS = { x: 0.65, y: 0.52 };
  // Scroll progress -> frame. The pour is quick in the footage, so it gets
  // more scroll; the opening and closing hold still for the titles.
  const KNOTS = [
    [0, 0], [0.07, 0], [0.36, 80], [0.78, 250], [0.96, FRAME_COUNT - 1], [1, FRAME_COUNT - 1],
  ];

  const canvas = document.getElementById('film');
  const ctx = canvas.getContext('2d');
  const loadingBar = document.getElementById('loading');
  const hint = document.getElementById('hint');
  const chapters = [...document.querySelectorAll('.chapter')].map((el) => ({
    el, a: parseFloat(el.dataset.in), b: parseFloat(el.dataset.out),
  }));

  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  function frameAt(p) {
    for (let i = 1; i < KNOTS.length; i++) {
      const [p0, f0] = KNOTS[i - 1], [p1, f1] = KNOTS[i];
      if (p <= p1) return f0 + (f1 - f0) * clamp01((p - p0) / (p1 - p0));
    }
    return FRAME_COUNT - 1;
  }

  // ---- Frame loading: first frame, then coarse-to-fine so scrubbing works
  // early (missing frames fall back to the nearest loaded one).
  // Pick the smallest frame set that is still sharp at the size the footage is
  // actually drawn on this screen (device pixels).
  function pickSet() {
    if (navigator.connection && navigator.connection.saveData) return 'frames-sm';
    const w = window.innerWidth, h = window.innerHeight;
    const drawn = w / h >= 1.2
      ? Math.max(w, (h * 16) / 9)
      : Math.min(w / 0.6, ((h * 0.62) * 16) / 9);
    const px = drawn * Math.min(window.devicePixelRatio || 1, 2);
    if (px <= 1400) return 'frames-sm';
    if (px <= 2100) return 'frames';
    return 'frames-hd';
  }
  const dir = pickSet();
  const frames = new Array(FRAME_COUNT).fill(null);
  let loaded = 0;

  const order = [];
  const seen = new Set();
  for (let step = 64; step >= 1; step >>= 1) {
    for (let i = 0; i < FRAME_COUNT; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); }
  }
  if (!seen.has(FRAME_COUNT - 1)) order.splice(1, 0, FRAME_COUNT - 1);

  const src = (i) => `${dir}/f${String(i + 1).padStart(3, '0')}.webp`;
  let cursor = 0;
  function loadNext() {
    if (cursor >= order.length) return;
    const i = order[cursor++];
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const done = () => {
        frames[i] = img;
        loaded++;
        loadingBar.style.transform = `scaleX(${loaded / FRAME_COUNT})`;
        if (loaded === FRAME_COUNT) loadingBar.classList.add('done');
        dirty = true;
        loadNext();
      };
      img.decode ? img.decode().then(done, done) : done();
    };
    img.onerror = loadNext;
    img.src = src(i);
  }
  for (let k = 0; k < 6; k++) loadNext();

  function nearestLoaded(i) {
    for (let d = 0; d < FRAME_COUNT; d++) {
      if (frames[i - d]) return frames[i - d];
      if (frames[i + d]) return frames[i + d];
    }
    return null;
  }

  // ---- Layout
  let cw = 0, ch = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = window.innerWidth;
    ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    dirty = true;
  }
  window.addEventListener('resize', resize);

  function placement(iw, ih) {
    let s, x, y;
    if (cw / ch >= 1.2) {
      // Landscape: fill the screen, like the original shot.
      s = Math.max(cw / iw, ch / ih);
      x = (cw - iw * s) * FOCUS.x;
      y = (ch - ih * s) * FOCUS.y;
    } else {
      // Portrait: size the bowl to the screen width and centre it above the
      // captions; the flat backdrop fills the rest.
      s = Math.min(cw / (iw * 0.6), (ch * 0.62) / ih);
      x = cw / 2 - FOCUS.x * iw * s;
      x = Math.min(0, Math.max(cw - iw * s, x));
      y = ch * 0.4 - FOCUS.y * ih * s;
    }
    return { s, x, y, w: iw * s, h: ih * s };
  }

  function feather(r) {
    // Fade any image edge that lands inside the screen into the backdrop.
    const f = Math.max(24, r.w * 0.08);
    const g2 = Math.max(24, r.h * 0.22);
    const edges = [
      [r.x > 0.5, r.x, r.y, r.x + f, r.y, r.x, r.y, f, r.h],
      [r.x + r.w < cw - 0.5, r.x + r.w, r.y, r.x + r.w - f, r.y, r.x + r.w - f, r.y, f, r.h],
      [r.y > 0.5, r.x, r.y, r.x, r.y + g2, r.x, r.y, r.w, g2],
      [r.y + r.h < ch - 0.5, r.x, r.y + r.h, r.x, r.y + r.h - g2, r.x, r.y + r.h - g2, r.w, g2],
    ];
    for (const [inside, x0, y0, x1, y1, rx, ry, rw, rh] of edges) {
      if (!inside) continue;
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, BG);
      g.addColorStop(1, 'rgba(238,237,241,0)');
      ctx.fillStyle = g;
      ctx.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
    }
  }

  // ---- Render
  let dirty = true;
  let shownFrame = -1;
  let progress = 0;

  function scrollProgress() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? clamp01(window.scrollY / max) : 0;
  }

  function draw(f) {
    const a = nearestLoaded(Math.round(f));
    if (!a) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cw, ch);
    const r = placement(a.naturalWidth, a.naturalHeight);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(a, r.x, r.y, r.w, r.h);
    feather(r);
  }

  function updateText(p) {
    for (const c of chapters) {
      const o = Math.min(smoothstep(c.a, c.a + 0.04, p), 1 - smoothstep(c.b - 0.04, c.b, p));
      c.el.style.opacity = o.toFixed(3);
      c.el.style.translate = `0 ${((1 - o) * 16).toFixed(1)}px`;
    }
    hint.style.opacity = (1 - smoothstep(0, 0.03, p)).toFixed(3);
  }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const goal = scrollProgress();
    // Ease toward the scroll position so wheel steps glide.
    progress += (goal - progress) * (1 - Math.exp(-dt * 8));
    if (Math.abs(goal - progress) < 1e-5) progress = goal;
    const f = frameAt(progress);
    if (dirty || Math.round(f) !== shownFrame) {
      draw(f);
      shownFrame = Math.round(f);
      dirty = false;
    }
    updateText(progress);
    requestAnimationFrame(tick);
  }

  resize();
  const qp = new URLSearchParams(location.search).get('p');
  if (qp !== null) {
    window.scrollTo(0, clamp01(parseFloat(qp)) * (document.documentElement.scrollHeight - window.innerHeight));
  }
  progress = scrollProgress();
  requestAnimationFrame(tick);
})();

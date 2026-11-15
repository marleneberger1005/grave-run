/* Grave Run — an original zombie maze-chase.  No build step, no dependencies. */
'use strict';
(() => {
  // ------------------------------------------------------------------ map
  const MAP = [
    '#####################',
    '#o.................o#',
    '#.##.###.#.#.###.##.#',
    '#...................#',
    '#.##.#.#######.#.##.#',
    '#....#....#....#....#',
    '####.####.#.####.####',
    '####.#.........#.####',
    '####.#..##-##..#.####',
    'T.......#ZZZ#.......T',
    '####.#..#####..#.####',
    '####.#.........#.####',
    '####.#.#######.#.####',
    '#.........#.........#',
    '#.##.####.#.####.##.#',
    '#o.#......P......#.o#',
    '##.#.#.#######.#.#.##',
    '#....#.........#....#',
    '#.######.###.######.#',
    '#...................#',
    '#####################',
  ];
  const COLS = 21, ROWS = 21, T = 32, W = COLS * T, H = ROWS * T;
  const TUNNEL_ROW = 9;
  const DOOR = { x: 10, y: 8 };
  const HOUSE_EXIT = { x: 10, y: 7 };
  const HOUSE_CENTER = { x: 10, y: 9 };
  const BONUS_TILE = { x: 10, y: 11 };

  const UP = { x: 0, y: -1 }, DOWN = { x: 0, y: 1 }, LEFT = { x: -1, y: 0 }, RIGHT = { x: 1, y: 0 };
  const DIR_LIST = [UP, LEFT, DOWN, RIGHT];
  const DIR_BY_NAME = { up: UP, down: DOWN, left: LEFT, right: RIGHT };

  const MODE_SCHEDULE = [['roam', 7], ['hunt', 20], ['roam', 7], ['hunt', 20], ['roam', 5], ['hunt', Infinity]];
  const BONUS_VALUES = [100, 300, 500, 700, 1000, 2000, 3000, 5000];

  const ZTYPES = [
    { name: 'Shambler', shirt: '#7d1f1f', skin: '#7f9a63', desc: 'Follows your scent. Never stops.', release: 0, corner: { x: COLS - 2, y: -3 }, scale: 1 },
    { name: 'Stalker', shirt: '#4a3466', skin: '#8a9c78', desc: 'Cuts you off up ahead.', release: 2.5, corner: { x: 1, y: -3 }, scale: 0.96 },
    { name: 'Crawler', shirt: '#355a3c', skin: '#a3aa6e', desc: 'Erratic. Loses nerve up close.', release: 6, corner: { x: 0, y: ROWS + 2 }, scale: 0.9 },
    { name: 'Brute', shirt: '#86521f', skin: '#6f8a58', desc: 'Flanks opposite the Shambler.', release: 10, corner: { x: COLS - 1, y: ROWS + 2 }, scale: 1.12 },
  ];

  // ------------------------------------------------------------------ utils
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function ellipse(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); }
  function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  function rrect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  const angOf = d => Math.atan2(d.y, d.x);
  function angLerp(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  // ------------------------------------------------------------------ grid
  let walls = [], pellets = [], playerStart = null, houseSpots = [], homeDist = [];
  const hd = (c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS) ? 9999 : homeDist[r][c];
  function parseMap() {
    walls = []; pellets = []; houseSpots = [];
    let count = 0;
    for (let r = 0; r < ROWS; r++) {
      walls[r] = []; pellets[r] = [];
      for (let c = 0; c < COLS; c++) {
        const ch = MAP[r][c];
        walls[r][c] = ch === '#';
        pellets[r][c] = ch === '.' ? 1 : ch === 'o' ? 2 : 0;
        if (pellets[r][c]) count++;
        if (ch === 'P') playerStart = { x: c, y: r };
        if (ch === 'Z') houseSpots.push({ x: c, y: r });
      }
    }
    // BFS distance-to-crypt, used by fallen zombies finding their way home
    homeDist = [];
    for (let r = 0; r < ROWS; r++) homeDist[r] = new Array(COLS).fill(9999);
    const q = [[HOUSE_CENTER.x, HOUSE_CENTER.y]];
    homeDist[HOUSE_CENTER.y][HOUSE_CENTER.x] = 0;
    while (q.length) {
      const [c, r] = q.shift();
      for (const d of DIR_LIST) {
        const nc = (c + d.x + COLS) % COLS, nr = r + d.y;
        if (nr < 0 || nr >= ROWS || walls[nr][nc] || homeDist[nr][nc] <= homeDist[r][c] + 1) continue;
        homeDist[nr][nc] = homeDist[r][c] + 1; q.push([nc, nr]);
      }
    }
    return count;
  }
  function isWall(c, r) {
    if (r < 0 || r >= ROWS) return true;
    if (c < 0 || c >= COLS) return r !== TUNNEL_ROW;
    return walls[r][c];
  }
  const isDoor = (c, r) => c === DOOR.x && r === DOOR.y;
  const isHouse = (c, r) => r === 9 && c >= 9 && c <= 11;
  const playerCanWalk = (c, r) => !isWall(c, r) && !isDoor(c, r) && !isHouse(c, r);
  const zombieCanWalk = (z, c, r) => !isWall(c, r) && (!isDoor(c, r) || z.state === 'leaving' || z.state === 'dead');

  // ------------------------------------------------------------------ canvas
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dark = document.createElement('canvas');
  const dctx = dark.getContext('2d');
  const bg = document.createElement('canvas');
  const bctx = bg.getContext('2d');
  const decals = document.createElement('canvas');
  const decctx = decals.getContext('2d');
  let DPR = 1;

  function sizeCanvases() {
    const rect = canvas.getBoundingClientRect();
    const want = Math.min(2.5, (window.devicePixelRatio || 1) * (rect.width / W || 1));
    DPR = Math.max(1, want);
    for (const c of [canvas, dark, bg, decals]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
    buildBackground();
    decctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    redrawDecals();
  }

  // ------------------------------------------------------------------ background (prerendered)
  function buildBackground() {
    const g = bctx, rng = mulberry32(1337);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.fillStyle = '#070908';
    g.fillRect(0, 0, W, H);

    // floor: weathered flagstones, dirt, moss and old blood
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (walls[r][c]) continue;
      const x = c * T, y = r * T, v = rng();
      if (isHouse(c, r)) {
        g.fillStyle = '#0a0606'; g.fillRect(x, y, T, T);
        const hg = g.createRadialGradient(x + T / 2, y + T / 2, 2, x + T / 2, y + T / 2, T);
        hg.addColorStop(0, 'rgba(140,10,20,.25)'); hg.addColorStop(1, 'rgba(140,10,20,0)');
        g.fillStyle = hg; g.fillRect(x, y, T, T);
        continue;
      }
      g.fillStyle = `rgb(${16 + v * 8 | 0},${21 + v * 9 | 0},${18 + v * 6 | 0})`;
      g.fillRect(x, y, T, T);
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1;
      g.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
      for (let i = 0; i < 10; i++) {
        g.fillStyle = rng() < .5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.3)';
        g.fillRect(x + rng() * T, y + rng() * T, 1 + rng() * 2, 1 + rng() * 2);
      }
      if (rng() < .12) { // crack
        g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; g.beginPath();
        let px = x + rng() * T, py = y + rng() * T; g.moveTo(px, py);
        for (let k = 0; k < 4; k++) { px += rand(-7, 7); py += rand(-7, 7); g.lineTo(px, py); }
        g.stroke();
      }
      if (rng() < .07) { // old blood
        g.fillStyle = 'rgba(80,6,10,.45)';
        const bx = x + rng() * T, by = y + rng() * T;
        for (let k = 0; k < 6; k++) ellipse(g, bx + rand(-6, 6), by + rand(-6, 6), rand(1, 5), rand(1, 4), rng() * 3);
      }
      if (rng() < .1) { // grass tufts
        g.strokeStyle = 'rgba(70,105,55,.55)'; g.lineWidth = 1;
        const gx = x + 4 + rng() * (T - 8), gy = y + 4 + rng() * (T - 8);
        g.beginPath();
        for (let k = 0; k < 5; k++) { g.moveTo(gx + k * 1.5, gy); g.lineTo(gx + k * 1.5 + rand(-2, 2), gy - rand(3, 6)); }
        g.stroke();
      }
    }

    // floor shadows cast by walls
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (walls[r][c]) continue;
      const x = c * T, y = r * T;
      const sh = (dx, dy) => isWall(c + dx, r + dy) && !(c + dx < 0 || c + dx >= COLS);
      const S = 9;
      if (sh(0, -1)) { const gr = g.createLinearGradient(0, y, 0, y + S); gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x, y, T, S); }
      if (sh(-1, 0)) { const gr = g.createLinearGradient(x, 0, x + S, 0); gr.addColorStop(0, 'rgba(0,0,0,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x, y, S, T); }
      if (sh(1, 0)) { const gr = g.createLinearGradient(x + T, 0, x + T - S, 0); gr.addColorStop(0, 'rgba(0,0,0,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x + T - S, y, S, T); }
    }

    // walls: mossy crypt stone
    const isW = (c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS) ? true : walls[r][c];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!walls[r][c]) continue;
      const x = c * T, y = r * T;
      const o = { t: !isW(c, r - 1), b: !isW(c, r + 1), l: !isW(c - 1, r), rt: !isW(c + 1, r) };
      const I = 3;
      const x0 = x + (o.l ? I : 0), y0 = y + (o.t ? I : 0), x1 = x + T - (o.rt ? I : 0), y1 = y + T - (o.b ? I : 0);
      const gr = g.createLinearGradient(0, y0, 0, y1);
      const v = rng();
      gr.addColorStop(0, `rgb(${40 + v * 8 | 0},${46 + v * 8 | 0},${42 + v * 6 | 0})`);
      gr.addColorStop(1, `rgb(${22 + v * 5 | 0},${26 + v * 5 | 0},${24 + v * 4 | 0})`);
      g.fillStyle = gr;
      const rad = 6;
      g.beginPath();
      g.moveTo(x0 + (o.t && o.l ? rad : 0), y0);
      if (o.t && o.rt) { g.lineTo(x1 - rad, y0); g.quadraticCurveTo(x1, y0, x1, y0 + rad); } else g.lineTo(x1, y0);
      if (o.b && o.rt) { g.lineTo(x1, y1 - rad); g.quadraticCurveTo(x1, y1, x1 - rad, y1); } else g.lineTo(x1, y1);
      if (o.b && o.l) { g.lineTo(x0 + rad, y1); g.quadraticCurveTo(x0, y1, x0, y1 - rad); } else g.lineTo(x0, y1);
      if (o.t && o.l) { g.lineTo(x0, y0 + rad); g.quadraticCurveTo(x0, y0, x0 + rad, y0); } else g.lineTo(x0, y0);
      g.closePath(); g.fill();

      // masonry
      g.save(); g.clip();
      g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 1;
      const off = (r % 2) * (T / 2);
      g.beginPath();
      g.moveTo(x, y + T / 2 + .5); g.lineTo(x + T, y + T / 2 + .5);
      g.moveTo(x + ((off + T / 4) % T) + .5, y); g.lineTo(x + ((off + T / 4) % T) + .5, y + T / 2);
      g.moveTo(x + ((off + 3 * T / 4) % T) + .5, y + T / 2); g.lineTo(x + ((off + 3 * T / 4) % T) + .5, y + T);
      g.stroke();
      for (let i = 0; i < 8; i++) {
        g.fillStyle = rng() < .5 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.25)';
        g.fillRect(x + rng() * T, y + rng() * T, 1 + rng() * 2, 1);
      }
      g.restore();

      // moss & rim light
      g.save();
      g.shadowColor = 'rgba(110,190,110,.55)'; g.shadowBlur = 10;
      g.strokeStyle = 'rgba(150,200,150,.22)'; g.lineWidth = 1.2;
      g.beginPath();
      if (o.t) { g.moveTo(x0 + (o.l ? rad : 0), y0 + .6); g.lineTo(x1 - (o.rt ? rad : 0), y0 + .6); }
      if (o.b) { g.moveTo(x0 + (o.l ? rad : 0), y1 - .6); g.lineTo(x1 - (o.rt ? rad : 0), y1 - .6); }
      if (o.l) { g.moveTo(x0 + .6, y0 + (o.t ? rad : 0)); g.lineTo(x0 + .6, y1 - (o.b ? rad : 0)); }
      if (o.rt) { g.moveTo(x1 - .6, y0 + (o.t ? rad : 0)); g.lineTo(x1 - .6, y1 - (o.b ? rad : 0)); }
      g.stroke();
      g.restore();
      if (o.t) for (let i = 0; i < 4; i++) {
        if (rng() < .55) { g.fillStyle = `rgba(${60 + rng() * 30 | 0},${100 + rng() * 40 | 0},${50 + rng() * 20 | 0},.55)`; ellipse(g, x0 + rng() * (x1 - x0), y0 + 1 + rng() * 2, 1.5 + rng() * 3, 1 + rng() * 1.5); }
      }
    }

    // crypt gate
    {
      const x = DOOR.x * T, y = DOOR.y * T;
      g.fillStyle = '#050303'; g.fillRect(x, y + 6, T, T - 12);
      g.strokeStyle = '#7a3b1e'; g.lineWidth = 2.2;
      g.beginPath();
      for (let i = 0; i < 5; i++) { const bx = x + 4 + i * 6; g.moveTo(bx, y + 8); g.lineTo(bx, y + T - 8); }
      g.moveTo(x + 1, y + T / 2); g.lineTo(x + T - 1, y + T / 2);
      g.stroke();
      g.fillStyle = '#a45a2a';
      for (let i = 0; i < 5; i++) { const bx = x + 4 + i * 6; g.beginPath(); g.moveTo(bx - 2, y + 9); g.lineTo(bx, y + 5); g.lineTo(bx + 2, y + 9); g.fill(); }
    }

    // tunnel mouths
    for (const side of [0, 1]) {
      const x = side ? W - T * 1.5 : 0;
      const gr = g.createLinearGradient(side ? W : 0, 0, side ? W - T * 1.5 : T * 1.5, 0);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, TUNNEL_ROW * T, T * 1.5, T);
    }

    // engraved headstones on the big side blocks
    for (const [cx, cy] of [[2, 7.3], [18, 7.3], [2, 11.3], [18, 11.3]]) drawHeadstone(g, cx * T, cy * T, rng);
  }

  function drawHeadstone(g, x, y, rng) {
    g.save();
    g.translate(x, y);
    g.rotate((rng() - .5) * .12);
    g.fillStyle = 'rgba(0,0,0,.45)'; ellipse(g, 2, 25, 17, 4);
    const gr = g.createLinearGradient(0, -14, 0, 24);
    gr.addColorStop(0, '#5b625c'); gr.addColorStop(1, '#2c312d');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(-13, 24); g.lineTo(-13, -2); g.arc(0, -2, 13, Math.PI, 0); g.lineTo(13, 24); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.fillRect(-1.2, -9, 2.4, 13); g.fillRect(-5, -5, 10, 2.4);
    g.font = '700 6px Inter, sans-serif'; g.textAlign = 'center';
    g.fillText('R.I.P', 0, 14);
    g.fillStyle = 'rgba(90,140,80,.6)'; ellipse(g, -7, 22, 6, 2.2); ellipse(g, 8, 23, 4, 1.8);
    g.restore();
  }

  // persistent blood decals (cleared per night)
  let decalList = [];
  function addDecal(x, y, scale = 1) {
    const blobs = [];
    for (let i = 0; i < 14; i++) blobs.push([x + rand(-12, 12) * scale, y + rand(-12, 12) * scale, rand(1.5, 6) * scale, rand(1, 4) * scale, rand(0, 3)]);
    decalList.push(blobs);
    drawDecal(blobs);
  }
  function drawDecal(blobs) {
    decctx.fillStyle = 'rgba(105,6,12,.55)';
    for (const b of blobs) ellipse(decctx, b[0], b[1], b[2], b[3], b[4]);
  }
  function redrawDecals() { decctx.clearRect(0, 0, W, H); decalList.forEach(drawDecal); }

  // ------------------------------------------------------------------ audio (all synthesized)
  const Sound = {
    ac: null, master: null, muted: store.get('graverun.muted', false), drone: null,
    init() {
      if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ac.destination);
      this.startDrone();
      Music.build();
    },
    setMuted(m) {
      this.muted = m; store.set('graverun.muted', m);
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ac.currentTime, 0.05);
    },
    startDrone() {
      const ac = this.ac, out = ac.createGain(); out.gain.value = 0.05; out.connect(this.master);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.connect(out);
      for (const f of [55, 55.4, 82.5]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start();
      }
      const lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = 0.07; lg.gain.value = 140; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      this.drone = out;
    },
    tone(freq, dur, { type = 'square', vol = 0.08, to = null, delay = 0 } = {}) {
      if (!this.ac) return;
      const t0 = this.ac.currentTime + delay;
      const o = this.ac.createOscillator(), g = this.ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.02);
    },
    noise(dur, { vol = 0.2, freq = 1200, q = 1, type = 'bandpass', delay = 0, to = null } = {}) {
      if (!this.ac) return;
      const t0 = this.ac.currentTime + delay;
      const len = Math.ceil(this.ac.sampleRate * dur);
      const buf = this.ac.createBuffer(1, len, this.ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const s = this.ac.createBufferSource(); s.buffer = buf;
      const f = this.ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
      if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      const g = this.ac.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t0);
    },
    pickup(alt) { this.tone(alt ? 660 : 520, 0.06, { type: 'triangle', vol: 0.05, to: alt ? 880 : 700 }); },
    flare() { this.noise(0.9, { vol: 0.35, freq: 400, to: 3000, q: 0.7 }); this.tone(180, 0.6, { type: 'sawtooth', vol: 0.06, to: 520 }); },
    kill(n) {
      this.noise(0.25, { vol: 0.45, freq: 900, q: 0.8, type: 'lowpass', to: 120 });
      this.tone(160, 0.35, { type: 'sawtooth', vol: 0.12, to: 40 });
      this.tone(400 + n * 140, 0.18, { type: 'square', vol: 0.05, delay: 0.08, to: 900 + n * 200 });
    },
    bonus() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', vol: 0.07, delay: i * 0.07 })); },
    life() { [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, { type: 'square', vol: 0.05, delay: i * 0.09 })); },
    death() {
      this.tone(420, 1.4, { type: 'sawtooth', vol: 0.14, to: 30 });
      this.noise(1.2, { vol: 0.3, freq: 600, to: 80, type: 'lowpass' });
      this.groan(0.2, 0.3);
    },
    groan(delay = 0, vol = 0.12) {
      if (!this.ac) return;
      const t0 = this.ac.currentTime + delay, dur = rand(0.9, 1.5);
      const o = this.ac.createOscillator(), g = this.ac.createGain(), f = this.ac.createBiquadFilter();
      const base = rand(70, 110);
      o.type = 'sawtooth'; o.frequency.setValueAtTime(base, t0);
      o.frequency.linearRampToValueAtTime(base * rand(0.75, 1.25), t0 + dur * 0.5);
      o.frequency.linearRampToValueAtTime(base * 0.7, t0 + dur);
      f.type = 'bandpass'; f.frequency.setValueAtTime(500, t0); f.frequency.linearRampToValueAtTime(800, t0 + dur * 0.4);
      f.frequency.linearRampToValueAtTime(350, t0 + dur); f.Q.value = 3;
      const vib = this.ac.createOscillator(), vg = this.ac.createGain(); vib.frequency.value = rand(5, 8); vg.gain.value = 6;
      vib.connect(vg); vg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(t0); vib.start(t0); o.stop(t0 + dur); vib.stop(t0 + dur);
    },
    heartbeat(intensity) {
      const v = 0.12 + intensity * 0.25;
      this.tone(58, 0.14, { type: 'sine', vol: v, to: 40 });
      this.tone(52, 0.16, { type: 'sine', vol: v * 0.8, to: 36, delay: 0.17 });
    },
    start() { [196, 233, 294, 233, 392].forEach((f, i) => this.tone(f, 0.28, { type: 'triangle', vol: 0.06, delay: i * 0.16 })); },
    clear() { [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.07, delay: i * 0.12 })); },
  };

  // ------------------------------------------------------------------ adaptive horror score
  // Layers fade in as tension rises: music box -> dissonant strings -> pulse -> shimmer -> whispers & stingers.
  const NOTE = n => 440 * 2 ** ((n - 69) / 12);
  const Music = {
    ready: false, tension: 0, target: 0, duck: 1,
    nextPulse: 0, pulseStep: 0, nextBox: 0, boxStep: 0, whisperT: 6, stingCd: 0, lastDread: 0,
    // a slightly broken lullaby in A minor, with a sour tritone
    BOX: [76, 77, 76, 71, 72, 71, 68, 69, null, 76, 75, 76, 69, 72, 71, 70, null, null],
    build() {
      const ac = Sound.ac; if (!ac || this.ready) return;
      this.ac = ac;
      this.bus = ac.createGain(); this.bus.gain.value = 1;
      const dry = ac.createGain(); dry.gain.value = 0.55;
      const wet = ac.createGain(); wet.gain.value = 0.7;
      const verb = ac.createConvolver();
      const len = Math.floor(ac.sampleRate * 3.6), ir = ac.createBuffer(2, len, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8); }
      verb.buffer = ir;
      this.bus.connect(dry); dry.connect(Sound.master);
      this.bus.connect(verb); verb.connect(wet); wet.connect(Sound.master);
      this.verbIn = verb;

      // dissonant string cluster (A, Bb, Eb, E, Bb)
      this.padFilter = ac.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 400; this.padFilter.Q.value = 2;
      this.pad = ac.createGain(); this.pad.gain.value = 0;
      this.padFilter.connect(this.pad); this.pad.connect(this.bus);
      for (const f of [110, 116.54, 155.56, 164.81, 233.08]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = rand(0.08, 0.3); lg.gain.value = rand(6, 14);
        lfo.connect(lg); lg.connect(o.detune); lfo.start();
        const og = ac.createGain(); og.gain.value = 0.2; o.connect(og); og.connect(this.padFilter); o.start();
      }
      // glassy high shimmer (D#6 against E6 — a minor second that won't resolve)
      this.shim = ac.createGain(); this.shim.gain.value = 0; this.shim.connect(this.bus);
      for (const f of [1244.5, 1318.5, 1864.7]) {
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const trem = ac.createOscillator(), tg = ac.createGain(), amp = ac.createGain();
        trem.frequency.value = rand(3, 7); tg.gain.value = 0.5; amp.gain.value = 0.5;
        trem.connect(tg); tg.connect(amp.gain); trem.start();
        o.connect(amp); amp.connect(this.shim); o.start();
      }
      // sub rumble
      this.sub = ac.createGain(); this.sub.gain.value = 0; this.sub.connect(Sound.master);
      const so = ac.createOscillator(); so.type = 'sine'; so.frequency.value = 36; so.connect(this.sub); so.start();
      const sl = ac.createOscillator(), sg = ac.createGain(); sl.frequency.value = 0.4; sg.gain.value = 4; sl.connect(sg); sg.connect(so.frequency); sl.start();

      this.nextPulse = this.nextBox = ac.currentTime + 0.3;
      this.ready = true;
    },
    env(node, t0, a, peak, d) {
      node.gain.setValueAtTime(0.0001, t0);
      node.gain.exponentialRampToValueAtTime(peak, t0 + a);
      node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    },
    boxNote(t0, midi, vol) {
      const ac = this.ac, f = NOTE(midi) * 2 ** (rand(-12, 12) / 1200); // out of tune, like an old toy
      for (const [mult, type, v] of [[1, 'triangle', 1], [2, 'sine', 0.35], [4.2, 'sine', 0.12]]) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.value = f * mult;
        o.connect(g); g.connect(this.bus); this.env(g, t0, 0.005, vol * v, 1.6);
        o.start(t0); o.stop(t0 + 1.7);
      }
    },
    pulse(t0, midi, vol, accent) {
      const ac = this.ac;
      const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = NOTE(midi);
      f.type = 'lowpass'; f.frequency.setValueAtTime(accent ? 900 : 500, t0); f.frequency.exponentialRampToValueAtTime(90, t0 + 0.3); f.Q.value = 6;
      o.connect(f); f.connect(g); g.connect(this.bus); this.env(g, t0, 0.004, vol, 0.32);
      o.start(t0); o.stop(t0 + 0.4);
      if (accent) { // low tom hit
        const k = ac.createOscillator(), kg = ac.createGain();
        k.frequency.setValueAtTime(90, t0); k.frequency.exponentialRampToValueAtTime(38, t0 + 0.3);
        k.connect(kg); kg.connect(Sound.master); this.env(kg, t0, 0.003, vol * 2.2, 0.35);
        k.start(t0); k.stop(t0 + 0.4);
      }
    },
    tick(t0, vol) {
      const ac = this.ac, len = Math.floor(ac.sampleRate * 0.04), b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = b; f.type = 'highpass'; f.frequency.value = 5000; g.gain.value = vol;
      s.connect(f); f.connect(g); g.connect(this.bus); s.start(t0);
    },
    whisper() {
      const ac = this.ac, t0 = ac.currentTime, dur = rand(0.7, 1.6);
      const len = Math.floor(ac.sampleRate * dur), b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const s = ac.createBufferSource(); s.buffer = b;
      const pan = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
      if (pan.pan) pan.pan.value = rand(-0.9, 0.9);
      const g = ac.createGain(); g.gain.value = 0;
      for (const fr of [rand(500, 900), rand(1100, 2600)]) { // two formants = a voice-like hiss
        const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 9;
        f.frequency.setValueAtTime(fr, t0); f.frequency.linearRampToValueAtTime(fr * rand(0.7, 1.4), t0 + dur);
        s.connect(f); f.connect(g);
      }
      // syllable-like stutter
      for (let k = 0, t = t0; t < t0 + dur; k++, t += rand(0.08, 0.18)) g.gain.setValueAtTime(k % 2 ? 0.02 : rand(0.25, 0.5), t);
      g.gain.setValueAtTime(0, t0 + dur);
      g.connect(pan); pan.connect(this.verbIn); pan.connect(this.bus);
      s.start(t0);
    },
    sting(swell = false) {
      if (!this.ready || this.stingCd > 0) return;
      this.stingCd = 7;
      const ac = this.ac, t0 = ac.currentTime + (swell ? 1.4 : 0);
      if (swell) { // reverse swell rushing into the hit
        const len = Math.floor(ac.sampleRate * 1.4), b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (i / len) ** 3;
        const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
        s.buffer = b; f.type = 'lowpass'; f.frequency.setValueAtTime(200, ac.currentTime); f.frequency.exponentialRampToValueAtTime(6000, t0);
        g.gain.value = 0.5; s.connect(f); f.connect(g); g.connect(this.bus); s.start();
      }
      // screeching string cluster
      for (let k = 0; k < 6; k++) {
        const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
        const base = rand(900, 1500);
        o.type = 'sawtooth'; o.frequency.setValueAtTime(base, t0); o.frequency.linearRampToValueAtTime(base * rand(1.03, 1.12), t0 + 1.4);
        const vib = ac.createOscillator(), vg = ac.createGain(); vib.frequency.value = rand(6, 11); vg.gain.value = base * 0.012;
        vib.connect(vg); vg.connect(o.frequency); vib.start(t0); vib.stop(t0 + 1.8);
        f.type = 'bandpass'; f.frequency.value = base * 1.5; f.Q.value = 1.5;
        o.connect(f); f.connect(g); g.connect(this.bus); this.env(g, t0, 0.015, 0.05, 1.6);
        o.start(t0); o.stop(t0 + 1.8);
      }
      // low boom
      const b = ac.createOscillator(), bg = ac.createGain();
      b.frequency.setValueAtTime(70, t0); b.frequency.exponentialRampToValueAtTime(24, t0 + 1.5);
      b.connect(bg); bg.connect(Sound.master); this.env(bg, t0, 0.01, 0.5, 1.6);
      b.start(t0); b.stop(t0 + 1.7);
    },
    update(dt, target, duck) {
      if (!this.ready) return;
      const ac = this.ac, now = ac.currentTime;
      this.tension = lerp(this.tension, target, Math.min(1, dt * (target > this.tension ? 1.6 : 0.6)));
      this.duck = lerp(this.duck, duck, Math.min(1, dt * 4));
      this.stingCd -= dt;
      const T = this.tension;
      this.bus.gain.setTargetAtTime(this.duck, now, 0.1);
      this.pad.gain.setTargetAtTime((0.01 + T ** 1.6 * 0.16) * this.duck, now, 0.3);
      this.padFilter.frequency.setTargetAtTime(250 + T * T * 3000, now, 0.4);
      this.shim.gain.setTargetAtTime(Math.max(0, T - 0.4) * 0.05 * this.duck, now, 0.5);
      this.sub.gain.setTargetAtTime(T * 0.22 * this.duck, now, 0.4);

      // pulse: from a slow ominous heartbeat-bass to a frantic chase
      if (this.nextPulse < now - 0.5) this.nextPulse = now;
      while (this.nextPulse < now + 0.12) {
        if (T > 0.22 && this.duck > 0.5) {
          const s = this.pulseStep++ % 8;
          const seq = [45, 45, 46, 45, 45, 45, 51, 46]; // A A Bb A A A Eb Bb
          this.pulse(this.nextPulse, seq[s], 0.05 + T * 0.09, s % 4 === 0);
          if (T > 0.6) this.tick(this.nextPulse + 0.5 * lerp(0.75, 0.2, T), 0.05 * T);
        }
        this.nextPulse += lerp(0.75, 0.17, clamp((T - 0.2) / 0.8, 0, 1));
      }
      // music box: loud when calm, fades as the dead close in
      if (this.nextBox < now - 0.5) this.nextBox = now;
      while (this.nextBox < now + 0.12) {
        const v = clamp(1 - T / 0.55, 0, 1) * 0.07 * this.duck;
        const n = this.BOX[this.boxStep++ % this.BOX.length];
        if (n && v > 0.003) this.boxNote(this.nextBox, n, v);
        this.nextBox += 0.48 * (1 + Math.random() * 0.12); // the mechanism drags
      }
      // whispers
      this.whisperT -= dt;
      if (this.whisperT <= 0) { if (T > 0.45 && this.duck > 0.5) this.whisper(); this.whisperT = lerp(9, 2.5, T) * rand(0.6, 1.4); }
    },
  };

  // ------------------------------------------------------------------ state
  const game = {
    state: 'title', score: 0, high: store.get('graverun.high', 0), lives: 3, level: 1,
    pelletsLeft: 0, eaten: 0, modeIndex: 0, modeTimer: 0, mode: 'roam',
    frightTimer: 0, frightTotal: 0, combo: 0, stateTimer: 0, freeze: 0,
    shake: 0, flash: 0, extraGiven: false, bonus: null, time: 0,
    heartTimer: 1, groanTimer: 4, prevState: null, banner: null,
  };
  let player = null, zombies = [], particles = [], fogBlobs = [];

  const lvl = () => {
    const L = game.level;
    return {
      pSpeed: Math.min(8.8, 7.4 + 0.22 * (L - 1)),
      zSpeed: Math.min(8.6, 6.5 + 0.3 * (L - 1)),
      frightSpeed: 3.9,
      frightTime: Math.max(1.6, 7 - 0.6 * (L - 1)),
      tunnelSpeed: 3.6,
      release: Math.max(0.3, 1 - 0.14 * (L - 1)),
    };
  };

  function resetActors() {
    player = {
      x: playerStart.x, y: playerStart.y, tx: playerStart.x, ty: playerStart.y,
      dir: LEFT, next: LEFT, face: Math.PI, walk: 0, moving: false,
    };
    const L = lvl();
    zombies = ZTYPES.map((t, i) => {
      const s = i === 0 ? HOUSE_EXIT : houseSpots[[1, 0, 2][i - 1]];
      return {
        i, type: t, x: s.x, y: s.y, tx: s.x, ty: s.y,
        dir: i === 0 ? LEFT : UP, face: i === 0 ? Math.PI : -Math.PI / 2,
        state: i === 0 ? 'active' : 'house', release: t.release * L.release,
        scared: false, reverse: false, walk: Math.random() * 10, hunterTarget: null, hunterTimer: 0,
      };
    });
    game.modeIndex = 0; game.mode = MODE_SCHEDULE[0][0]; game.modeTimer = MODE_SCHEDULE[0][1];
    game.frightTimer = 0; game.combo = 0; game.bonus = null; game.freeze = 0;
  }

  function newGame() {
    game.score = 0; game.lives = 3; game.level = 1; game.extraGiven = false;
    startLevel();
    Sound.start();
  }
  function startLevel() {
    game.pelletsLeft = game.pelletTotal = parseMap(); game.eaten = 0;
    decalList = []; redrawDecals();
    particles = [];
    resetActors();
    setState('ready', 2.2);
    game.banner = { title: `Night ${game.level}`, sub: game.level === 1 ? 'Survive until dawn' : 'They are getting faster' };
    updateHud();
  }
  function setState(s, t = 0) { game.state = s; game.stateTimer = t; }

  // ------------------------------------------------------------------ movement
  function advance(e, dist, onArrive) {
    let guard = 0;
    while (dist > 1e-6 && guard++ < 8) {
      const dx = e.tx - e.x, dy = e.ty - e.y;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d <= dist) {
        e.x = e.tx; e.y = e.ty; dist -= d;
        if (e.x < 0) e.x = COLS; else if (e.x > COLS - 1) e.x = -1;
        if (!onArrive(e)) return false;
      } else {
        e.x += Math.sign(dx) * dist; e.y += Math.sign(dy) * dist;
        dist = 0;
      }
    }
    return true;
  }

  function playerArrive(p) {
    const c = Math.round(p.x), r = Math.round(p.y);
    eatAt(c, r);
    if (p.next && playerCanWalk(c + p.next.x, r + p.next.y)) p.dir = p.next;
    if (playerCanWalk(c + p.dir.x, r + p.dir.y)) { p.tx = c + p.dir.x; p.ty = r + p.dir.y; p.moving = true; return true; }
    p.moving = false;
    return false;
  }

  function zombieTarget(z) {
    if (z.state === 'dead') return HOUSE_CENTER;
    if (z.state === 'leaving') return HOUSE_EXIT;
    if (game.mode === 'roam') return z.type.corner;
    const pc = { x: Math.round(player.x), y: Math.round(player.y) };
    switch (z.i) {
      case 0: return pc;
      case 1: return { x: pc.x + player.dir.x * 4, y: pc.y + player.dir.y * 4 };
      case 2: {
        const d = Math.hypot(z.x - pc.x, z.y - pc.y);
        return d > 7 ? pc : z.type.corner;
      }
      case 3: {
        const s = zombies[0];
        const ax = pc.x + player.dir.x * 2, ay = pc.y + player.dir.y * 2;
        return { x: ax + (ax - Math.round(s.x)), y: ay + (ay - Math.round(s.y)) };
      }
    }
    return pc;
  }

  function zombieArrive(z) {
    const c = Math.round(z.x), r = Math.round(z.y);
    if (z.state === 'dead' && c === HOUSE_CENTER.x && r === HOUSE_CENTER.y) { z.state = 'leaving'; z.reverse = true; }
    if (z.state === 'leaving' && c === HOUSE_EXIT.x && r === HOUSE_EXIT.y) { z.state = 'active'; z.dir = Math.random() < .5 ? LEFT : RIGHT; }

    const allowReverse = z.reverse || z.state === 'leaving';
    z.reverse = false;
    let opts = DIR_LIST.filter(d => (allowReverse || !(d.x === -z.dir.x && d.y === -z.dir.y)) && zombieCanWalk(z, c + d.x, r + d.y));
    if (!opts.length) opts = DIR_LIST.filter(d => zombieCanWalk(z, c + d.x, r + d.y));
    if (!opts.length) return false;

    let pick;
    if (z.state === 'dead') {
      let best = Infinity;
      for (const d of opts) { const v = hd(c + d.x, r + d.y); if (v < best) { best = v; pick = d; } }
    } else if (z.scared && z.state === 'active') {
      // flee: prefer directions that increase distance from the survivor, with some chaos
      const pc = { x: player.x, y: player.y };
      opts.sort((a, b) => Math.hypot(c + b.x - pc.x, r + b.y - pc.y) - Math.hypot(c + a.x - pc.x, r + a.y - pc.y));
      pick = Math.random() < .7 ? opts[0] : opts[Math.floor(Math.random() * opts.length)];
    } else if (game.state === 'title' && z.state === 'active') {
      pick = opts[Math.floor(Math.random() * opts.length)];
    } else {
      const t = zombieTarget(z);
      let best = Infinity;
      for (const d of opts) {
        const dd = (c + d.x - t.x) ** 2 + (r + d.y - t.y) ** 2;
        if (dd < best) { best = dd; pick = d; }
      }
    }
    z.dir = pick; z.tx = c + pick.x; z.ty = r + pick.y;
    return true;
  }

  function zombieSpeed(z) {
    const L = lvl();
    if (z.state === 'dead') return 15;
    if (z.state === 'leaving') return 4.2;
    if (Math.round(z.y) === TUNNEL_ROW && (z.x < 4 || z.x > COLS - 5)) return L.tunnelSpeed;
    if (z.scared) return L.frightSpeed;
    let s = L.zSpeed;
    if (z.i === 0 && game.pelletsLeft < 30) s *= 1.08;
    if (z.i === 2) s *= 0.96;
    return s;
  }

  // ------------------------------------------------------------------ gameplay
  function addScore(n) {
    game.score += n;
    if (!game.extraGiven && game.score >= 10000) { game.extraGiven = true; game.lives++; Sound.life(); popup(player.x, player.y - 1, '+1 LIFE', '#ff4d5a'); }
    if (game.score > game.high) { game.high = game.score; store.set('graverun.high', game.high); }
    updateHud();
  }

  function eatAt(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    const p = pellets[r][c];
    if (!p) return;
    pellets[r][c] = 0; game.pelletsLeft--; game.eaten++;
    if (p === 1) {
      addScore(10); Sound.pickup(game.eaten % 2);
      burst((c + .5) * T, (r + .5) * T, 4, ['#cfe9a8', '#8fd16a'], 40, 0.35, 1.4);
    } else {
      addScore(50); igniteFlare(c, r);
    }
    if (game.eaten === 70 || game.eaten === 150) game.bonus = { x: BONUS_TILE.x, y: BONUS_TILE.y, t: 9.5 };
    if (game.pelletsLeft <= 0) { setState('clear', 2.6); Sound.clear(); game.banner = { title: 'Dawn breaks', sub: `Night ${game.level} survived` }; }
  }

  function igniteFlare(c, r) {
    const L = lvl();
    game.frightTimer = game.frightTotal = L.frightTime;
    game.combo = 0;
    for (const z of zombies) if (z.state !== 'dead') { z.scared = true; if (z.state === 'active') z.reverse = true; }
    Sound.flare();
    game.flash = Math.max(game.flash, 0.25); game.flashColor = '255,140,40';
    burst((c + .5) * T, (r + .5) * T, 40, ['#ffb347', '#ff6a1c', '#fff1c1'], 220, 0.8, 2.5);
  }

  function checkCollisions() {
    for (const z of zombies) {
      if (z.state === 'dead' || z.state === 'house' || z.state === 'leaving' && !z.scared && Math.round(z.y) >= 8) continue;
      const d = Math.hypot(z.x - player.x, z.y - player.y);
      if (d > 0.62) continue;
      if (z.scared) {
        z.scared = false; z.state = 'dead';
        const pts = 200 * 2 ** Math.min(game.combo, 3);
        game.combo++;
        addScore(pts);
        popup(z.x, z.y, String(pts), '#ffb347');
        const px = (z.x + .5) * T, py = (z.y + .5) * T;
        burst(px, py, 34, ['#9b0d15', '#5e050a', '#d22a2a'], 170, 0.9, 3);
        burst(px, py, 16, ['#ffb347', '#ff6a1c'], 120, 0.5, 2);
        addDecal(px, py, z.type.scale);
        Sound.kill(game.combo);
        game.shake = Math.max(game.shake, 7);
        game.freeze = 0.35;
      } else {
        die();
        return;
      }
    }
  }

  function die() {
    setState('dying', 2.1);
    Sound.death();
    Music.stingCd = 0; Music.sting();
    game.shake = 14; game.flash = 0.75; game.flashColor = '180,0,10';
    const px = (player.x + .5) * T, py = (player.y + .5) * T;
    burst(px, py, 60, ['#9b0d15', '#5e050a', '#d22a2a', '#3a0205'], 220, 1.2, 3.4);
    addDecal(px, py, 1.6);
  }

  function update(dt) {
    game.time += dt;
    for (const f of fogBlobs) { f.x += f.vx * dt; if (f.x > W + f.r) f.x = -f.r; if (f.x < -f.r) f.x = W + f.r; }
    updateParticles(dt);
    game.shake = Math.max(0, game.shake - dt * 30);
    game.flash = Math.max(0, game.flash - dt * 1.4);

    if (game.state === 'title') { for (const z of zombies) updateZombie(z, dt * 0.7); return; }
    if (game.state === 'paused' || game.state === 'over') return;
    if (game.state === 'ready') { game.stateTimer -= dt; if (game.stateTimer <= 0) { setState('play'); game.banner = null; } return; }
    if (game.state === 'dying') {
      game.stateTimer -= dt;
      if (game.stateTimer <= 0) {
        game.lives--; updateHud();
        if (game.lives <= 0) gameOver();
        else { resetActors(); setState('ready', 1.6); game.banner = { title: 'Get up', sub: `${game.lives} ${game.lives === 1 ? 'life' : 'lives'} left` }; }
      }
      return;
    }
    if (game.state === 'clear') {
      game.stateTimer -= dt;
      if (game.stateTimer <= 0) { game.level++; startLevel(); }
      return;
    }
    if (game.freeze > 0) { game.freeze -= dt; return; }

    // global mode schedule (paused while a flare burns)
    if (game.frightTimer > 0) {
      game.frightTimer -= dt;
      if (game.frightTimer <= 0) { game.frightTimer = 0; for (const z of zombies) z.scared = false; }
    } else {
      game.modeTimer -= dt;
      if (game.modeTimer <= 0 && game.modeIndex < MODE_SCHEDULE.length - 1) {
        game.modeIndex++;
        [game.mode, game.modeTimer] = MODE_SCHEDULE[game.modeIndex];
        for (const z of zombies) if (z.state === 'active') z.reverse = true;
        if (game.mode === 'hunt') { Sound.groan(0, 0.1); Music.sting(true); }
      }
    }

    // player
    const p = player, L = lvl();
    if (!p.moving) playerArrive(p);
    advance(p, L.pSpeed * dt, playerArrive);
    if (p.moving) p.walk += dt * 12;
    p.face = angLerp(p.face, angOf(p.dir), Math.min(1, dt * 18));

    // zombies
    for (const z of zombies) updateZombie(z, dt);

    // bonus
    if (game.bonus) {
      game.bonus.t -= dt;
      if (game.bonus.t <= 0) game.bonus = null;
      else if (Math.hypot(p.x - game.bonus.x, p.y - game.bonus.y) < 0.6) {
        const v = BONUS_VALUES[Math.min(game.level - 1, BONUS_VALUES.length - 1)];
        addScore(v); popup(game.bonus.x, game.bonus.y, String(v), '#8fd16a'); Sound.bonus();
        burst((game.bonus.x + .5) * T, (game.bonus.y + .5) * T, 24, ['#ffffff', '#8fd16a', '#ff4d5a'], 140, 0.6, 2);
        game.bonus = null;
      }
    }

    if (game.state === 'play') checkCollisions();

    // dread: heartbeat & groans by proximity
    let nearest = Infinity;
    for (const z of zombies) if (z.state === 'active' && !z.scared) nearest = Math.min(nearest, Math.hypot(z.x - p.x, z.y - p.y));
    const intensity = clamp(1 - (nearest - 1.5) / 7, 0, 1);
    game.dread = lerp(game.dread || 0, intensity, Math.min(1, dt * 3));
    game.heartTimer -= dt;
    if (intensity > 0.05 && game.heartTimer <= 0) { Sound.heartbeat(intensity); game.heartTimer = lerp(1.25, 0.42, intensity); }
    game.groanTimer -= dt;
    if (game.groanTimer <= 0) { if (nearest < 7) Sound.groan(0, 0.05 + intensity * 0.1); game.groanTimer = rand(2.5, 6); }
    if (game.dread > 0.8 && game.lastDread <= 0.8) Music.sting();
    game.lastDread = game.dread;
  }

  function updateZombie(z, dt) {
    z.walk += dt * (z.scared ? 16 : 7);
    if (z.state === 'house') {
      if (game.state !== 'title') { z.release -= dt; if (z.release <= 0) { z.state = 'leaving'; } }
      return;
    }
    advance(z, zombieSpeed(z) * dt, zombieArrive);
    z.face = angLerp(z.face, angOf(z.dir), Math.min(1, dt * 10));
  }

  function musicTension() {
    const s = game.state;
    if (s === 'title' || s === 'over') return 0.05;
    if (s === 'clear') return 0;
    if (s === 'dying') return 1;
    const progress = game.pelletTotal ? 1 - game.pelletsLeft / game.pelletTotal : 0;
    let t = 0.12 + progress * 0.4 + Math.min(game.level - 1, 5) * 0.05 + (game.dread || 0) * 0.5 + (game.mode === 'hunt' ? 0.08 : 0);
    if (game.frightTimer > 0) t = t * 0.5 + 0.25; // a breath of courage while the flare burns
    return clamp(t, 0, 1);
  }

  function gameOver() {
    setState('over');
    document.getElementById('overScore').textContent = game.score.toLocaleString();
    document.getElementById('overHigh').textContent = game.high.toLocaleString();
    document.getElementById('overNight').textContent = game.level;
    const msgs = ['They got you. They always do, eventually.', 'Your flashlight rolls into the dark, still on.', 'Ashgrove claims another soul.', 'One more shambler joins the horde.'];
    document.getElementById('overMsg').textContent = game.score >= game.high && game.score > 0 ? 'A new record. The dead will remember your name.' : msgs[Math.floor(Math.random() * msgs.length)];
    showScreen('overScreen');
  }

  // ------------------------------------------------------------------ particles
  function burst(x, y, n, colors, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.25 + Math.random() * 0.75);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.5 + Math.random() * 0.5), max: life, color: colors[i % colors.length], size: size * (0.5 + Math.random()) });
    }
  }
  function popup(tx, ty, text, color) {
    particles.push({ x: (tx + .5) * T, y: (ty + .5) * T, vx: 0, vy: -28, life: 1.1, max: 1.1, color, text });
  }
  function updateParticles(dt) {
    for (const q of particles) {
      q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (!q.text) { q.vx *= 1 - dt * 4; q.vy *= 1 - dt * 4; }
    }
    particles = particles.filter(q => q.life > 0);
    // ambient embers rising from flares
    if (Math.random() < dt * 12) for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (pellets[r] && pellets[r][c] === 2 && Math.random() < 0.25) particles.push({ x: (c + .5) * T + rand(-3, 3), y: (r + .3) * T, vx: rand(-8, 8), vy: rand(-40, -20), life: .7, max: .7, color: '#ffb347', size: 1.2, ember: true });
    }
  }

  // ------------------------------------------------------------------ drawing: actors
  function drawSurvivor(g, cx, cy, ang, walk, s = T, dying = 0) {
    g.save(); g.translate(cx, cy);
    g.fillStyle = 'rgba(0,0,0,.5)'; ellipse(g, 0, s * .1, s * .36, s * .28);
    g.rotate(ang);
    if (dying > 0) { g.scale(1 - dying * .2, 1 - dying * .2); g.rotate(dying * 1.4); }
    const sway = Math.sin(walk) * .09;
    // backpack
    g.fillStyle = '#4a3622'; rrect(g, -s * .36, -s * .18, s * .16, s * .36, 3); g.fill();
    g.fillStyle = '#2e2116'; g.fillRect(-s * .36, -s * .03, s * .16, s * .06);
    // arms + flashlight
    g.fillStyle = '#3c4a30';
    g.save(); g.rotate(-.35 + sway); rrect(g, 0, -s * .27, s * .3, s * .1, 3); g.fill(); g.restore();
    g.save(); g.rotate(.35 - sway); rrect(g, 0, s * .17, s * .3, s * .1, 3); g.fill(); g.restore();
    g.fillStyle = '#d4a989'; circle(g, s * .31, -s * .06, s * .06); circle(g, s * .31, s * .06, s * .06);
    g.fillStyle = '#2b2f33'; rrect(g, s * .3, -s * .045, s * .2, s * .09, 2); g.fill();
    g.fillStyle = '#fff6cf'; g.fillRect(s * .48, -s * .045, s * .03, s * .09);
    // torso
    const tg = g.createLinearGradient(-s * .2, 0, s * .2, 0);
    tg.addColorStop(0, '#3a4a2e'); tg.addColorStop(1, '#56693f');
    g.fillStyle = tg; ellipse(g, 0, 0, s * .22, s * .3);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -s * .28); g.lineTo(0, s * .28); g.stroke();
    // head
    g.fillStyle = '#d4a989'; circle(g, s * .04, 0, s * .15);
    g.fillStyle = '#2a1b12'; g.beginPath(); g.arc(s * .01, 0, s * .155, Math.PI * .45, Math.PI * 1.55); g.fill();
    g.fillStyle = '#7a2020'; g.fillRect(-s * .06, -s * .16, s * .05, s * .32); // bandana
    g.restore();
  }

  function drawZombie(g, z, cx, cy, s = T) {
    const sc = s * z.type.scale, t = game.time;
    const fr = game.frightTimer, flashing = z.scared && fr > 0 && fr < 1.8 && Math.floor(t * 8) % 2 === 0;
    g.save(); g.translate(cx, cy);
    if (z.state === 'dead') {
      // a drifting skull, hurrying back to the crypt
      g.globalAlpha = .75;
      g.fillStyle = '#d9d2bf'; circle(g, 0, -1, sc * .17); g.fillRect(-sc * .09, sc * .08, sc * .18, sc * .08);
      g.fillStyle = '#0b0b0b'; circle(g, -sc * .065, -sc * .02, sc * .05); circle(g, sc * .065, -sc * .02, sc * .05);
      g.restore(); return;
    }
    const lurch = z.scared ? Math.sin(t * 50 + z.i) * 1.2 : 0;
    g.translate(lurch, 0);
    g.fillStyle = 'rgba(0,0,0,.5)'; ellipse(g, 0, sc * .12, sc * .4, sc * .3);
    g.rotate(z.face + Math.sin(z.walk * .9) * .08);
    const skin = z.scared ? (flashing ? '#f2f6f8' : '#a7bfd2') : z.type.skin;
    const shirt = z.scared ? (flashing ? '#d6dee4' : '#3f5468') : z.type.shirt;
    const sway = Math.sin(z.walk) * .16;

    // arms reaching forward (or thrown up in fear)
    for (const side of [-1, 1]) {
      g.save();
      if (z.scared) { g.translate(-sc * .05, side * sc * .2); g.rotate(side * 1.9 + Math.sin(t * 30) * .2); }
      else { g.translate(sc * .02, side * sc * .19); g.rotate(side * .1 + side * sway); }
      g.fillStyle = shirt; rrect(g, 0, -sc * .06, sc * .3, sc * .12, 3); g.fill();
      g.fillStyle = skin; rrect(g, sc * .26, -sc * .055, sc * .16, sc * .11, 3); g.fill();
      g.fillStyle = 'rgba(0,0,0,.25)';
      for (let k = 0; k < 3; k++) g.fillRect(sc * .4, -sc * .05 + k * sc * .04, sc * .05, sc * .02);
      g.restore();
    }
    // torso (tattered)
    g.fillStyle = shirt;
    g.beginPath();
    const N = 14;
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * Math.PI * 2;
      const j = (k % 2 ? .86 : 1) * (1 + Math.sin(k * 7.3 + z.i) * .05);
      g.lineTo(Math.cos(a) * sc * .23 * j, Math.sin(a) * sc * .32 * j);
    }
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.25)'; ellipse(g, -sc * .08, sc * .06, sc * .08, sc * .12);
    if (!z.scared) { g.fillStyle = 'rgba(120,8,14,.75)'; ellipse(g, sc * .06, -sc * .1, sc * .06, sc * .05); ellipse(g, -sc * .02, sc * .14, sc * .04, sc * .05); }
    // head
    g.fillStyle = skin; circle(g, sc * .06, 0, sc * .16);
    g.fillStyle = 'rgba(0,0,0,.22)'; circle(g, sc * .01, sc * .05, sc * .06); circle(g, sc * .1, -sc * .08, sc * .035);
    g.strokeStyle = 'rgba(30,20,15,.7)'; g.lineWidth = 1;
    g.beginPath(); for (let k = 0; k < 5; k++) { g.moveTo(-sc * .04, -sc * .1 + k * sc * .05); g.lineTo(-sc * .13, -sc * .12 + k * sc * .06); } g.stroke();
    // eyes (base; glow added in light pass)
    g.fillStyle = z.scared ? '#ffffff' : '#ff2a2a';
    circle(g, sc * .16, -sc * .065, sc * .03); circle(g, sc * .16, sc * .065, sc * .03);
    g.restore();
  }

  function zombieEyePositions(z) {
    const sc = T * z.type.scale, cx = (z.x + .5) * T, cy = (z.y + .5) * T;
    const ca = Math.cos(z.face), sa = Math.sin(z.face);
    return [-1, 1].map(s => ({ x: cx + ca * sc * .16 - sa * s * sc * .065, y: cy + sa * sc * .16 + ca * s * sc * .065 }));
  }

  // ------------------------------------------------------------------ drawing: lights
  const RAYS = 220;
  function visibilityPolygon(px, py, maxR) {
    const pts = [];
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let d = 0, hit = maxR;
      while (d < maxR) {
        d += 0.12;
        const tx = Math.floor((px + ca * d * T) / T), ty = Math.floor((py + sa * d * T) / T);
        if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS || walls[ty][tx]) { hit = d + 0.28; break; }
      }
      pts.push([px + ca * hit * T, py + sa * hit * T]);
    }
    return pts;
  }

  function renderLighting() {
    const d = dctx;
    d.setTransform(DPR, 0, 0, DPR, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W, H);
    const playing = game.state !== 'title';
    const fr = game.frightTimer > 0;
    const amb = !playing ? 0.62 : fr ? 0.74 : game.state === 'clear' ? lerp(0.9, 0.3, 1 - game.stateTimer / 2.6) : 0.91;
    d.fillStyle = `rgba(2,4,3,${amb})`;
    d.fillRect(0, 0, W, H);
    d.globalCompositeOperation = 'destination-out';

    if (playing && player) {
      const px = (player.x + .5) * T, py = (player.y + .5) * T;
      const t = game.time;
      let flick = 1 + Math.sin(t * 13) * .015 + Math.sin(t * 31) * .01;
      if (Math.sin(t * 0.7) > .985) flick *= .55 + Math.random() * .3; // the battery is dying...
      if (game.state === 'dying') flick *= Math.max(0, game.stateTimer / 2.1);
      const R = (fr ? 7.5 : 4.4) * flick;
      const poly = visibilityPolygon(px, py, Math.max(R, 9.5));
      d.save();
      d.beginPath(); poly.forEach(([x, y], i) => (i ? d.lineTo(x, y) : d.moveTo(x, y))); d.closePath(); d.clip();
      let gr = d.createRadialGradient(px, py, T * .3, px, py, R * T);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(.5, 'rgba(0,0,0,.8)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = gr; d.fillRect(0, 0, W, H);
      // flashlight cone
      const a = player.face, len = 9.5 * T * flick, spread = .44;
      gr = d.createRadialGradient(px, py, T * .4, px, py, len);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(.55, 'rgba(0,0,0,.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = gr;
      d.beginPath(); d.moveTo(px, py); d.arc(px, py, len, a - spread, a + spread); d.closePath(); d.fill();
      d.restore();
    }
    // small lights: flares, bonus, embers, explosions
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (pellets[r][c] !== 2) continue;
      const x = (c + .5) * T, y = (r + .5) * T, rr = T * (1.6 + Math.sin(game.time * 9 + c) * .15);
      const gr = d.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(0,0,0,.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = gr; d.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    if (game.bonus) {
      const x = (game.bonus.x + .5) * T, y = (game.bonus.y + .5) * T, rr = T * 1.4;
      const gr = d.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(0,0,0,.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = gr; d.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    ctx.drawImage(dark, 0, 0, W, H);
  }

  // things that glow through the darkness
  function renderGlow() {
    const g = ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const t = game.time;
    // soul shards (faint so the maze stays readable)
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const p = pellets[r][c];
      if (p === 1) {
        g.fillStyle = 'rgba(143,209,106,.16)'; circle(g, (c + .5) * T, (r + .5) * T, 4.5);
      } else if (p === 2) {
        const x = (c + .5) * T, y = (r + .5) * T, rr = 14 + Math.sin(t * 11 + r) * 2;
        const gr = g.createRadialGradient(x, y, 0, x, y, rr);
        gr.addColorStop(0, 'rgba(255,150,50,.65)'); gr.addColorStop(1, 'rgba(255,80,20,0)');
        g.fillStyle = gr; circle(g, x, y, rr);
      }
    }
    // zombie eyes
    for (const z of zombies) {
      const eyes = z.state === 'dead'
        ? [-1, 1].map(k => ({ x: (z.x + .5) * T + k * T * z.type.scale * .065, y: (z.y + .5) * T - T * z.type.scale * .02 }))
        : zombieEyePositions(z);
      const col = z.state === 'dead' ? '220,220,255' : z.scared ? '170,210,255' : '255,30,30';
      const pulse = .75 + Math.sin(t * 4 + z.i * 2) * .25;
      for (const e of eyes) {
        const gr = g.createRadialGradient(e.x, e.y, 0, e.x, e.y, 7);
        gr.addColorStop(0, `rgba(${col},${.95 * pulse})`); gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr; circle(g, e.x, e.y, 7);
      }
    }
    // particles
    for (const q of particles) {
      const a = clamp(q.life / q.max, 0, 1);
      if (q.text) continue;
      if (q.ember || q.color.startsWith('#ff') || q.color.startsWith('#fff') || q.color.startsWith('#cf') || q.color === '#8fd16a') {
        g.fillStyle = q.color; g.globalAlpha = a; circle(g, q.x, q.y, q.size);
      }
    }
    g.globalAlpha = 1;
    // flashlight lens
    if (player && game.state !== 'title' && game.state !== 'dying') {
      const lx = (player.x + .5) * T + Math.cos(player.face) * T * .5, ly = (player.y + .5) * T + Math.sin(player.face) * T * .5;
      const gr = g.createRadialGradient(lx, ly, 0, lx, ly, 10);
      gr.addColorStop(0, 'rgba(255,245,200,.9)'); gr.addColorStop(1, 'rgba(255,245,200,0)');
      g.fillStyle = gr; circle(g, lx, ly, 10);
    }
    g.restore();
  }

  // ------------------------------------------------------------------ render
  function render() {
    const g = ctx;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, W, H);
    g.save();
    if (game.shake > 0) g.translate(rand(-1, 1) * game.shake, rand(-1, 1) * game.shake);

    g.drawImage(bg, 0, 0, W, H);
    g.drawImage(decals, 0, 0, W, H);

    const t = game.time;
    // pellets
    const clearBlink = game.state === 'clear' && Math.floor(t * 6) % 2;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const p = pellets[r][c];
      if (!p) continue;
      const x = (c + .5) * T, y = (r + .5) * T;
      if (p === 1) {
        g.save(); g.translate(x, y); g.rotate(Math.PI / 4 + Math.sin(t * 2 + c * r) * .2);
        g.fillStyle = '#cfe9a8'; g.fillRect(-2.2, -2.2, 4.4, 4.4);
        g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(-2.2, -2.2, 2, 2);
        g.restore();
      } else {
        // road flare stick
        g.save(); g.translate(x, y + Math.sin(t * 3 + c) * 1); g.rotate(-.7);
        g.fillStyle = '#b3121b'; rrect(g, -3, -9, 6, 15, 2); g.fill();
        g.fillStyle = '#f1e6c8'; g.fillRect(-3, -2, 6, 3);
        g.fillStyle = '#2b2b2b'; g.fillRect(-3, 5, 6, 2);
        const fl = 1 + Math.sin(t * 25 + c) * .2;
        g.fillStyle = '#ff6a1c'; circle(g, 0, -10, 4 * fl);
        g.fillStyle = '#ffd27a'; circle(g, 0, -10.5, 2.2 * fl);
        g.restore();
      }
    }
    // bonus: medkit
    if (game.bonus) {
      const b = game.bonus, x = (b.x + .5) * T, y = (b.y + .5) * T + Math.sin(t * 4) * 1.5;
      if (b.t > 2 || Math.floor(t * 8) % 2) {
        g.fillStyle = 'rgba(0,0,0,.45)'; ellipse(g, x, y + 10, 10, 3);
        g.fillStyle = '#e9e2cf'; rrect(g, x - 10, y - 8, 20, 16, 3); g.fill();
        g.fillStyle = '#c4bca6'; g.fillRect(x - 10, y + 4, 20, 4);
        g.fillStyle = '#d01c26'; g.fillRect(x - 2.5, y - 6, 5, 12); g.fillRect(x - 6, y - 2.5, 12, 5);
        g.fillStyle = '#6b6555'; g.fillRect(x - 4, y - 11, 8, 3);
      }
    }

    // zombies
    for (const z of zombies) {
      let zx = (z.x + .5) * T, zy = (z.y + .5) * T;
      if (z.state === 'house') zy += Math.sin(t * 3 + z.i * 2) * 3;
      drawZombie(g, z, zx, zy);
    }
    // survivor
    if (game.state !== 'title' && player) {
      const dying = game.state === 'dying' ? 1 - game.stateTimer / 2.1 : 0;
      if (game.state !== 'over') drawSurvivor(g, (player.x + .5) * T, (player.y + .5) * T, player.face, player.walk, T, dying);
    }
    // blood particles (non-glowing)
    for (const q of particles) {
      if (q.text || q.ember) continue;
      g.globalAlpha = clamp(q.life / q.max, 0, 1);
      g.fillStyle = q.color; circle(g, q.x, q.y, q.size);
    }
    g.globalAlpha = 1;

    // fog
    for (const f of fogBlobs) {
      const gr = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      gr.addColorStop(0, `rgba(150,170,155,${f.a})`); gr.addColorStop(1, 'rgba(150,170,155,0)');
      g.fillStyle = gr; g.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }

    renderLighting();
    renderGlow();

    // flare tint
    if (game.frightTimer > 0) {
      g.fillStyle = `rgba(255,110,30,${.05 + Math.sin(t * 20) * .015})`;
      g.fillRect(0, 0, W, H);
    }
    // dread vignette
    if (game.dread > .05 && game.state === 'play') {
      const gr = g.createRadialGradient(W / 2, H / 2, W * .3, W / 2, H / 2, W * .75);
      gr.addColorStop(0, 'rgba(120,0,0,0)'); gr.addColorStop(1, `rgba(140,0,8,${game.dread * (.35 + Math.sin(t * 8) * .08)})`);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    // popups
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const q of particles) {
      if (!q.text) continue;
      g.globalAlpha = clamp(q.life / q.max * 1.5, 0, 1);
      g.font = '20px Creepster, cursive';
      g.fillStyle = '#000'; g.fillText(q.text, q.x + 1.5, q.y + 1.5);
      g.fillStyle = q.color; g.fillText(q.text, q.x, q.y);
    }
    g.globalAlpha = 1;
    g.restore();

    if (game.flash > 0) { g.fillStyle = `rgba(${game.flashColor || '180,0,10'},${game.flash})`; g.fillRect(0, 0, W, H); }

    // banners
    if (game.banner && (game.state === 'ready' || game.state === 'clear')) {
      const a = game.state === 'ready' ? clamp(game.stateTimer * 2, 0, 1) : 1;
      g.save();
      g.globalAlpha = a;
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 52, W, 104);
      const lg = g.createLinearGradient(0, 0, W, 0);
      lg.addColorStop(0, 'rgba(179,18,27,0)'); lg.addColorStop(.5, 'rgba(179,18,27,.8)'); lg.addColorStop(1, 'rgba(179,18,27,0)');
      g.fillStyle = lg; g.fillRect(0, H / 2 - 52, W, 1.5); g.fillRect(0, H / 2 + 51, W, 1.5);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '54px Creepster, cursive';
      g.shadowColor = 'rgba(226,35,46,.8)'; g.shadowBlur = 20;
      g.fillStyle = '#e2232e'; g.fillText(game.banner.title, W / 2, H / 2 - 10);
      g.shadowBlur = 0;
      g.font = '15px "Special Elite", monospace'; g.fillStyle = '#c9c3b0';
      g.fillText(game.banner.sub.toUpperCase(), W / 2, H / 2 + 30);
      g.restore();
    }
  }

  // ------------------------------------------------------------------ HUD & screens
  const $ = id => document.getElementById(id);
  const hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
  function updateHud() {
    setText('score', game.score.toLocaleString());
    setText('high', game.high.toLocaleString());
    setText('level', String(game.level));
    if (hudCache.lives !== game.lives) {
      hudCache.lives = game.lives;
      $('lives').innerHTML = '<i></i>'.repeat(clamp(game.lives, 0, 6));
    }
  }
  function updateFlareMeter() {
    const on = game.frightTimer > 0 && game.state === 'play';
    $('flareMeter').classList.toggle('on', on);
    if (on) $('flareFill').style.transform = `scaleX(${game.frightTimer / game.frightTotal})`;
  }
  function showScreen(id) {
    for (const s of ['titleScreen', 'pauseScreen', 'overScreen']) $(s).classList.toggle('hidden', s !== id);
  }

  function buildBestiary() {
    const wrap = $('bestiary');
    for (const t of ZTYPES) {
      const card = document.createElement('div'); card.className = 'beast';
      const cv = document.createElement('canvas'); cv.width = 108; cv.height = 108;
      const g = cv.getContext('2d');
      const fake = { i: ZTYPES.indexOf(t), type: t, face: Math.PI / 2, walk: 1, scared: false, state: 'active' };
      g.scale(108 / 64, 108 / 64);
      const bgG = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      bgG.addColorStop(0, 'rgba(179,18,27,.25)'); bgG.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = bgG; g.fillRect(0, 0, 64, 64);
      drawZombie(g, fake, 32, 30, 48);
      card.appendChild(cv);
      const n = document.createElement('strong'); n.textContent = t.name; n.style.color = t.shirt === '#4a3466' ? '#a68bd0' : t.shirt === '#355a3c' ? '#8fd16a' : t.shirt === '#86521f' ? '#e19a52' : '#e2232e';
      const d = document.createElement('span'); d.textContent = t.desc;
      card.append(n, d);
      wrap.appendChild(card);
    }
  }

  // ------------------------------------------------------------------ input
  function setDir(name) {
    const d = DIR_BY_NAME[name];
    if (!d || !player || (game.state !== 'play' && game.state !== 'ready')) return;
    player.next = d;
    // instant reversal mid-corridor feels much better
    if (player.moving && d.x === -player.dir.x && d.y === -player.dir.y) {
      player.tx -= player.dir.x; player.ty -= player.dir.y; player.dir = d;
    }
  }
  function startGame() {
    Sound.init();
    showScreen(null);
    newGame();
  }
  function togglePause() {
    if (game.state === 'play' || game.state === 'ready') { game.prevState = game.state; setState('paused', game.stateTimer); showScreen('pauseScreen'); }
    else if (game.state === 'paused') { showScreen(null); setState(game.prevState, game.stateTimer); }
  }
  const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
  window.addEventListener('keydown', e => {
    if (KEYMAP[e.key]) { e.preventDefault(); setDir(KEYMAP[e.key]); return; }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') togglePause();
    if (e.key === 'm' || e.key === 'M') toggleMute();
    if ((e.key === 'Enter' || e.key === ' ') && (game.state === 'title' || game.state === 'over')) { e.preventDefault(); startGame(); }
  });
  function toggleMute() { Sound.init(); Sound.setMuted(!Sound.muted); $('muteBtn').classList.toggle('muted', Sound.muted); }
  $('muteBtn').classList.toggle('muted', Sound.muted);
  // browsers only allow audio after a gesture: wake the score on the first one
  const wake = () => { Sound.init(); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
  window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake);
  $('muteBtn').addEventListener('click', toggleMute);
  $('pauseBtn').addEventListener('click', togglePause);
  $('startBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('resumeBtn').addEventListener('click', togglePause);
  document.querySelectorAll('#dpad button').forEach(b => {
    b.addEventListener('pointerdown', e => { e.preventDefault(); setDir(b.dataset.dir); });
  });
  // swipe
  let touch = null;
  const stage = $('stage');
  stage.addEventListener('touchstart', e => { const t0 = e.touches[0]; touch = { x: t0.clientX, y: t0.clientY }; }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (!touch) return;
    const t0 = e.touches[0], dx = t0.clientX - touch.x, dy = t0.clientY - touch.y;
    if (Math.hypot(dx, dy) > 22) {
      setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      touch = { x: t0.clientX, y: t0.clientY };
    }
    if (game.state === 'play') e.preventDefault();
  }, { passive: false });
  document.addEventListener('visibilitychange', () => { if (document.hidden && (game.state === 'play' || game.state === 'ready')) togglePause(); });

  // ------------------------------------------------------------------ loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    update(dt);
    Music.update(dt, musicTension(), game.state === 'paused' ? 0.2 : 1);
    render();
    updateFlareMeter();
    requestAnimationFrame(frame);
  }

  function boot() {
    parseMap();
    resetActors();
    // attract mode: let the horde wander the yard behind the title card
    zombies.forEach(z => { if (z.state === 'house') z.state = 'leaving'; });
    for (let i = 0; i < 9; i++) fogBlobs.push({ x: rand(0, W), y: rand(0, H), r: rand(90, 200), vx: rand(-12, 12), a: rand(.03, .07) });
    sizeCanvases();
    buildBestiary();
    updateHud();
    let resizeT;
    window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(sizeCanvases, 150); });
    requestAnimationFrame(frame);
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(boot); else boot();
})();

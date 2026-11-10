// Scenario definitions (data only, built by small helpers).
//
// Scenario shape:
// {
//   id, title, description, difficulty,
//   bounds: {x, y, w, h}          – world rectangle in metres (edges act as invisible walls)
//   bg: '#color'                  – ground colour outside drawn scenery
//   start: {x, y, angle}          – player body-centre pose
//   targets: [{x, y, w, h, angle, headings: [rad], tol: deg, requireStop?, label?}]
//   obstacles: [{type: car|curb|wall|island|hedge|post, x, y, w, h, angle, color?}]
//   scenery: [{type: rect|line|tree|arrow|text, layer?: 'top', ...}]
// }
// Rect-shaped things are centre-based: w is the size along `angle`, h across it.

const D2R = Math.PI / 180;
const PI = Math.PI;

const CAR_COLORS = [
  '#c62828', '#1565c0', '#2e7d32', '#37474f', '#8d939a', '#212121', '#6d4c41',
  '#f9a825', '#00838f', '#ad1457', '#90a4ae', '#283593', '#4e342e', '#7b1fa2', '#e65100',
];

const C = {
  grass: '#5f8a43',
  asphalt: '#3d4147',
  lot: '#474b52',
  sidewalk: '#b3ada3',
  paint: '#eceff1',
  yellow: '#ffd54f',
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parkedCar(rand, x, y, angle, { jitter = 0.08, angJitter = 2.5 } = {}) {
  return {
    type: 'car',
    x: x + (rand() - 0.5) * 2 * jitter,
    y: y + (rand() - 0.5) * 2 * jitter,
    w: 4.1 + rand() * 0.6,
    h: 1.74 + rand() * 0.14,
    angle: angle + (rand() - 0.5) * 2 * angJitter * D2R,
    color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)],
  };
}

const rect = (x, y, w, h, fill, extra = {}) => ({ type: 'rect', x, y, w, h, angle: 0, fill, ...extra });
const line = (pts, color = C.paint, width = 0.12, dash = null) => ({ type: 'line', pts, color, width, dash });
const tree = (x, y, r = 1.1) => ({ type: 'tree', x, y, r, layer: 'top' });
const curb = (x, y, w, h, angle = 0) => ({ type: 'curb', x, y, w, h, angle });
/** Walls along the top and bottom map edges (behind the sidewalks), like the car-park walls. */
const edgeWalls = (W, H, t = 0.3) => [
  { type: 'wall', x: W / 2, y: t / 2, w: W, h: t, angle: 0 },
  { type: 'wall', x: W / 2, y: H - t / 2, w: W, h: t, angle: 0 },
];

// ---------------------------------------------------------------- street (parallel)

/** dropNeighbours: leave out the parked car directly in front of and behind the gap. */
function streetScenario({ id, title, description, difficulty, gap, gapStart, dropNeighbours = false, seed }) {
  const rand = mulberry32(seed);
  const W = 40, H = 16;
  const gapEnd = gapStart + gap;
  const scenery = [
    rect(W / 2, 1.25, W, 2.5, C.sidewalk),
    rect(W / 2, 8, W, 10.6, C.asphalt),
    rect(W / 2, 14.75, W, 2.5, C.sidewalk),
    line([[0, 8], [W, 8]], C.paint, 0.12, [3, 3]),
    line([[0, 11.1], [W, 11.1]], 'rgba(236,239,241,0.55)', 0.1, [0.5, 0.5]),
    line([[0, 4.9], [W, 4.9]], 'rgba(236,239,241,0.55)', 0.1, [0.5, 0.5]),
  ];
  for (let x = 4; x < W; x += 9) scenery.push(tree(x + rand() * 2, 15.0, 1.0 + rand() * 0.2));
  for (let x = 2; x < W; x += 11) scenery.push(tree(x + rand() * 2, 1.0, 0.9 + rand() * 0.2));

  const obstacles = [
    curb(W / 2, 2.6, W, 0.2), curb(W / 2, 13.4, W, 0.2), ...edgeWalls(W, H),
    ...streetCars(rand, W, gapStart, gapEnd, dropNeighbours),
  ];
  return {
    id, title, description, difficulty,
    bounds: { x: 0, y: 0, w: W, h: H },
    bg: C.grass,
    start: { x: 5, y: 9.55, angle: 0 },
    targets: [{ x: (gapStart + gapEnd) / 2, y: 12.15, w: gap - 0.1, h: 2.3, angle: 0, headings: [0], tol: 6 }],
    obstacles,
    scenery,
  };
}

/** Parked cars of the parallel-parking street: a packed right-hand row with one gap, and sparse cars opposite. */
function streetCars(rand, W, gapStart, gapEnd, dropNeighbours = false) {
  const laneY = 12.2;
  const obstacles = [];
  const onStreet = (c) => c.x - c.w / 2 >= 0 && c.x + c.w / 2 <= W; // drop cars sticking out past the ends
  // Cars behind the gap.
  let pos = gapStart, first = true;
  while (pos > -3) {
    const c = parkedCar(rand, 0, laneY, 0, { jitter: 0.05, angJitter: 1.5 });
    c.x = pos - c.w / 2 - 0.05;
    if (onStreet(c) && !(dropNeighbours && first)) obstacles.push(c);
    first = false;
    pos -= c.w + 1.0 + rand() * 1.4;
  }
  // Cars ahead of the gap.
  pos = gapEnd;
  first = true;
  while (pos < W + 3) {
    const c = parkedCar(rand, 0, laneY, 0, { jitter: 0.05, angJitter: 1.5 });
    c.x = pos + c.w / 2 + 0.05;
    if (onStreet(c) && !(dropNeighbours && first)) obstacles.push(c);
    first = false;
    pos += c.w + 1.0 + rand() * 1.4;
  }
  // A few cars parked on the opposite side.
  for (let x = 3; x < W; x += 5.5 + rand() * 6) {
    const c = parkedCar(rand, x, 3.8, PI, { jitter: 0.05, angJitter: 1.5 });
    if (onStreet(c)) obstacles.push(c);
  }
  return obstacles;
}

// ---------------------------------------------------------------- street turn-around

/**
 * Two-lane street with cars parked along both curbs (same cross-section as the parallel scenarios).
 * gaps: { top: [[x0, x1], ...], bottom: [...] } – free curb space; elsewhere cars are packed with
 * `spacing` = [min, max] metres between them.
 */
function turnAroundScenario({ id, title, description, difficulty, gaps = {}, spacing, parallelLayout, noCars = false, fitRows = false, length = 40, seed }) {
  const rand = mulberry32(seed);
  // Cross-section: 2.5 m sidewalk, curb, [parking lane], two 3.1 m driving lanes, parking lane, curb,
  // 2.5 m sidewalk. The empty street has no parking lane on the far (top) side, so it is narrower.
  const W = length;
  const parkTop = noCars ? 0 : 2.2, parkBot = 2.2;
  const road = parkTop + 6.2 + parkBot;
  const curbTop = 2.6, curbBot = curbTop + 0.2 + road;
  const H = curbBot + 0.1 + 2.5;
  const mid = curbTop + 0.1 + parkTop + 3.1;          // centre line
  const laneTop = mid - 1.55, laneBot = mid + 1.55;   // driving-lane centres
  const scenery = [
    rect(W / 2, 1.25, W, 2.5, C.sidewalk),
    rect(W / 2, curbTop + 0.1 + road / 2, W, road, C.asphalt),
    rect(W / 2, H - 1.25, W, 2.5, C.sidewalk),
    line([[0, mid], [W, mid]], C.paint, 0.12, [3, 3]),
  ];
  const parkLine = (y) => scenery.push(line([[0, y], [W, y]], 'rgba(236,239,241,0.55)', 0.1, [0.5, 0.5]));
  if (parkTop) parkLine(mid - 3.1);
  if (parkBot) parkLine(mid + 3.1);
  for (const f of [0.43, 0.78]) scenery.push({ type: 'arrow', x: W * f, y: laneBot, angle: 0, len: 2.4 });
  for (const f of [0.55, 0.85]) scenery.push({ type: 'arrow', x: W * f, y: laneTop, angle: PI, len: 2.4 });
  const treeGap = noCars ? 1.5 : 1; // sparser trees on the empty street
  for (let x = 4; x < W; x += 9 * treeGap) scenery.push(tree(x + rand() * 2, H - 1.0, 1.0 + rand() * 0.2));
  for (let x = 2; x < W; x += 11 * treeGap) scenery.push(tree(x + rand() * 2, 1.0, 0.9 + rand() * 0.2));

  const obstacles = [curb(W / 2, curbTop, W, 0.2), curb(W / 2, curbBot, W, 0.2), ...edgeWalls(W, H)];
  const fillRow = (y, angle, rowGaps) => {
    let pos = -3;
    while (pos < W + 3) {
      const c = parkedCar(rand, 0, y, angle, { jitter: 0.05, angJitter: 1.5 });
      const g = rowGaps.find(([g0, g1]) => pos < g1 && pos + c.w > g0);
      if (g) { pos = g[1]; continue; }
      c.x = pos + c.w / 2;
      if (pos >= 0 && pos + c.w <= W) obstacles.push(c); // only cars fully on the street
      pos += c.w + spacing[0] + rand() * (spacing[1] - spacing[0]);
    }
  };
  // Row of cars spanning the whole curb end to end: as many cars as fit, gaps evened out to fill it.
  const fitRow = (y, angle) => {
    const L = W - 0.6, cars = [];
    let natural = 0;
    for (;;) {
      const c = parkedCar(rand, 0, y, angle, { jitter: 0.05, angJitter: 1.5 });
      const gap = spacing[0] + rand() * (spacing[1] - spacing[0]);
      if (cars.length && natural + c.w / 2 > L) break; // stop at the car count closest to L
      cars.push([c, gap]);
      natural += c.w + gap;
    }
    const carLen = cars.reduce((n, [c]) => n + c.w, 0);
    const gapSum = cars.slice(0, -1).reduce((n, [, g]) => n + g, 0);
    const k = (L - carLen) / gapSum;
    let pos = 0.3;
    for (const [c, g] of cars) {
      c.x = pos + c.w / 2;
      obstacles.push(c);
      pos += c.w + g * k;
    }
  };
  if (noCars) {
    // empty street
  } else if (fitRows) {
    fitRow(curbTop + 0.1 + parkTop / 2, PI);
    fitRow(mid + 3.1 + parkBot / 2, 0);
  } else if (parallelLayout) {
    // Same parked cars as the parallel-parking street (identical with the same seed).
    obstacles.push(...streetCars(rand, W, parallelLayout.gapStart, parallelLayout.gapStart + parallelLayout.gap));
  } else {
    fillRow(3.8, PI, gaps.top || []);
    fillRow(12.2, 0, gaps.bottom || []);
  }
  return {
    id, title, description, difficulty,
    bounds: { x: 0, y: 0, w: W, h: H },
    bg: C.grass,
    start: { x: 5, y: laneBot, angle: 0 },
    targets: [{ x: 5.5, y: laneTop, w: 9, h: 3.0, angle: 0, headings: [PI], tol: 12, requireStop: false }],
    obstacles,
    scenery,
  };
}

// ---------------------------------------------------------------- perpendicular lot

function lotScenario({ id, title, description, difficulty, target, extraEmpty = [], seed }) {
  const rand = mulberry32(seed);
  const W = 30, H = 21, bw = 2.6, depth = 5, x0 = 2, count = 10;
  const rows = {
    top: { y0: 2.2, cy: 4.7 },
    bottom: { y0: 13.7, cy: 16.2 },
  };
  const scenery = [
    rect(W / 2, 10.45, W, 16.5, C.lot),
    rect(W / 2, 1.0, W, 2.0, C.sidewalk),
    rect(W / 2, (18.9 + H) / 2, W, H - 18.9, C.sidewalk),
  ];
  for (const r of Object.values(rows)) {
    for (let i = 0; i <= count; i++) {
      const x = x0 + i * bw;
      scenery.push(line([[x, r.y0], [x, r.y0 + depth]], C.paint, 0.12));
    }
  }
  scenery.push({ type: 'arrow', x: 9, y: 10.45, angle: 0, len: 2.4 });
  scenery.push({ type: 'arrow', x: 23, y: 10.45, angle: 0, len: 2.4 });
  for (let x = 3; x < W; x += 6.5) scenery.push(tree(x + rand() * 2, 20.0, 1.0));
  for (let x = 1; x < W; x += 7) scenery.push(tree(x + rand() * 2, 0.9, 0.8));

  const obstacles = [curb(W / 2, 2.1, W, 0.2), curb(W / 2, 18.8, W, 0.2), ...edgeWalls(W, H)];
  const empty = new Set([`${target.row}${target.index}`, ...extraEmpty]);
  for (const [name, r] of Object.entries(rows)) {
    for (let i = 0; i < count; i++) {
      if (empty.has(`${name}${i}`)) continue;
      const nose = rand() < 0.5 ? PI / 2 : -PI / 2;
      obstacles.push(parkedCar(rand, x0 + (i + 0.5) * bw, r.cy, nose));
    }
  }
  return {
    id, title, description, difficulty,
    bounds: { x: 0, y: 0, w: W, h: H },
    bg: C.grass,
    start: { x: 3, y: 10.45, angle: 0 },
    targets: [{
      x: x0 + (target.index + 0.5) * bw, y: rows[target.row].cy, w: bw, h: depth, angle: 0,
      headings: [target.heading], tol: 7,
    }],
    obstacles,
    scenery,
  };
}

// ---------------------------------------------------------------- angled bays

function angledScenario({ id, title, description, difficulty, alphaDeg, entry, targetIndex, seed }) {
  const rand = mulberry32(seed);
  const W = 36, bw = 2.6, depth = 5, aisle = 6;
  const alpha = alphaDeg * D2R;
  const sa = Math.abs(Math.sin(alpha)), ca = Math.abs(Math.cos(alpha));
  const spacing = bw / sa;
  const shift = (bw / 2) * (ca / sa); // keeps the bay rectangle's near corner on the aisle edge
  const reach = (shift + depth) * sa + (bw / 2) * ca;
  const topEdge = 1.6 + reach + 0.2;
  const botEdge = topEdge + aisle;
  const topCurb = topEdge - reach - 0.15;
  const botCurb = botEdge + reach + 0.15;
  const H = botCurb + 1.8;
  const count = Math.floor((W - 4) / spacing);
  const x0 = (W - count * spacing) / 2;

  const bays = [];
  const makeRow = (edge, ang, offset) => {
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const row = [];
    for (let i = 0; i < count; i++) {
      const mx = x0 + (i + 0.5) * spacing + offset;
      const d = shift + depth / 2;
      row.push({ x: mx + ux * d, y: edge + uy * d, angle: ang });
    }
    return row;
  };
  const top = makeRow(topEdge, alpha, 0);
  const bottom = makeRow(botEdge, -alpha, spacing / 2).slice(0, count - 1);
  bays.push(...top, ...bottom);

  const scenery = [
    rect(W / 2, (topCurb + botCurb) / 2, W, botCurb - topCurb, C.lot),
    rect(W / 2, topCurb / 2, W, topCurb, C.sidewalk),
    rect(W / 2, (botCurb + H) / 2, W, H - botCurb, C.sidewalk),
  ];
  for (const b of bays) {
    const ux = Math.cos(b.angle), uy = Math.sin(b.angle);
    const nx = -uy, ny = ux;
    for (const side of [-1, 1]) {
      const px = b.x + side * nx * bw / 2, py = b.y + side * ny * bw / 2;
      scenery.push(line([[px - ux * depth / 2, py - uy * depth / 2], [px + ux * depth / 2, py + uy * depth / 2]], C.paint, 0.12));
    }
  }
  scenery.push({ type: 'arrow', x: 8, y: (topEdge + botEdge) / 2, angle: 0, len: 2.4 });
  scenery.push({ type: 'arrow', x: 28, y: (topEdge + botEdge) / 2, angle: 0, len: 2.4 });
  for (let x = 2; x < W; x += 7) scenery.push(tree(x + rand() * 2, H - 0.8, 0.9));

  const obstacles = [curb(W / 2, topCurb, W, 0.2), curb(W / 2, botCurb, W, 0.2), ...edgeWalls(W, H)];
  top.forEach((b, i) => {
    if (i === targetIndex) return;
    obstacles.push(parkedCar(rand, b.x, b.y, rand() < 0.8 ? b.angle : b.angle + PI));
  });
  bottom.forEach((b, i) => {
    if (i === 3) return; // one free bay on the other side, for realism
    obstacles.push(parkedCar(rand, b.x, b.y, rand() < 0.8 ? b.angle : b.angle + PI));
  });

  const tb = top[targetIndex];
  const heading = entry === 'forward' ? tb.angle : tb.angle + PI;
  return {
    id, title, description, difficulty,
    bounds: { x: 0, y: 0, w: W, h: H },
    bg: C.grass,
    start: { x: 3, y: (topEdge + botEdge) / 2 + 0.6, angle: 0 },
    targets: [{ x: tb.x, y: tb.y, w: depth, h: bw, angle: tb.angle, headings: [heading], tol: 7 }],
    obstacles,
    scenery,
  };
}

// ---------------------------------------------------------------- car park

function carParkScenario({ id, title, description, difficulty, mode, seed }) {
  const rand = mulberry32(seed);
  const bw = 2.6, depth = 5, aisle = 4; // very tight car park
  const bx0 = 6, count = 7;                  // bays per row
  const rowEnd = bx0 + count * bw;           // 24.2
  const islandR = [rowEnd, rowEnd + 1.6];    // end-of-row island on the right
  const lane = [islandR[1], islandR[1] + aisle]; // narrow U-turn lane
  const colX = [lane[1], lane[1] + depth];   // column of bays along the right wall
  const LW = colX[1] + 0.4;                  // lot width incl. right wall
  const X0 = 0;
  const yA = 0.4, yAisle1 = yA + depth, yB = yAisle1 + aisle, yMid = yB + depth;
  const yAisle2 = yMid + depth, yC = yAisle2 + aisle, yBottom = yC + depth;
  const H = yBottom + 0.4;
  const rows = {
    A: { y0: yA, cy: yA + depth / 2 },
    B1: { y0: yB, cy: yB + depth / 2 },
    B2: { y0: yMid, cy: yMid + depth / 2 },
    C: { y0: yC, cy: yC + depth / 2 },
  };
  const aisle1 = (yAisle1 + yB) / 2;   // centre line of aisle 1
  const aisle2 = (yAisle2 + yC) / 2;   // centre line of aisle 2
  const bayX = (i) => bx0 + (i + 0.5) * bw;
  const colCount = Math.floor((yBottom - yA) / bw);
  const colY = (j) => yA + (j + 0.5) * bw;

  const scenery = [
    rect(LW / 2, H / 2, LW, H, C.lot),
  ];
  for (const r of Object.values(rows)) {
    for (let i = 0; i <= count; i++) {
      const x = bx0 + i * bw;
      scenery.push(line([[x, r.y0], [x, r.y0 + depth]], C.paint, 0.12));
    }
  }
  for (let j = 0; j <= colCount; j++) {
    const y = yA + j * bw;
    scenery.push(line([[colX[0], y], [colX[1], y]], C.paint, 0.12));
  }
  scenery.push(line([[bx0, yMid], [rowEnd, yMid]], C.paint, 0.12));
  for (const x of [10, 19]) scenery.push({ type: 'arrow', x, y: aisle1, angle: 0, len: 2.4 });
  for (const x of [19, 10]) scenery.push({ type: 'arrow', x, y: aisle2, angle: PI, len: 2.4 });
  scenery.push({ type: 'arrow', x: (lane[0] + lane[1]) / 2, y: yMid, angle: PI / 2, len: 2.4 });
  const ix = (islandR[0] + islandR[1]) / 2;
  scenery.push(tree(2.0, yB + 2.6, 1.0), tree(4.0, yAisle2 - 2.6, 1.1), tree(ix, yB + 0.6, 0.75), tree(ix, yMid, 0.75), tree(ix, yAisle2 - 0.6, 0.75));

  const obstacles = [
    { type: 'wall', x: LW / 2, y: 0.2, w: LW, h: 0.4, angle: 0 },
    { type: 'wall', x: LW / 2, y: H - 0.2, w: LW, h: 0.4, angle: 0 },
    { type: 'wall', x: LW - 0.2, y: H / 2, w: 0.4, h: H, angle: 0 },

    { type: 'island', x: (0.4 + bx0) / 2, y: yMid, w: bx0 - 0.4, h: 2 * depth - 0.2, angle: 0 },
    { type: 'island', x: ix, y: yMid, w: islandR[1] - islandR[0], h: 2 * depth - 0.2, angle: 0 },
  ];
  obstacles.push({ type: 'wall', x: 0.2, y: H / 2, w: 0.4, h: H, angle: 0 }); // left wall

  let start, targets;
  const empty = new Set();
  if (mode === 'exit') {
    empty.add('B1:1');               // the player's own bay
    empty.add('A:4'); empty.add('C:2'); empty.add('R:8');
    start = { x: bayX(1), y: rows.B1.cy, angle: -PI / 2 };
    targets = [{ // exit box at the far end of aisle 2
      x: 3.2, y: aisle2, w: 5.4, h: aisle - 0.1, angle: 0, headings: [PI], tol: 20,
      requireStop: false, label: 'EXIT',
    }];
  } else {
    const free = [['A', 5], ['B2', 2], ['C', 4]];
    targets = free.map(([row, i]) => {
      empty.add(`${row}:${i}`);
      return { x: bayX(i), y: rows[row].cy, w: bw, h: depth, angle: 0, headings: [PI / 2, -PI / 2], tol: 7 };
    });
    start = { x: 3.7, y: aisle1, angle: 0 }; // inside the car park, at the start of aisle 1
  }
  for (const [name, r] of Object.entries(rows)) {
    for (let i = 0; i < count; i++) {
      if (empty.has(`${name}:${i}`)) continue;
      obstacles.push(parkedCar(rand, bayX(i), r.cy, rand() < 0.6 ? PI / 2 : -PI / 2));
    }
  }
  // Right-hand column: these parked cars delimit the U-turn lane.
  for (let j = 0; j < colCount; j++) {
    if (empty.has(`R:${j}`)) continue;
    obstacles.push(parkedCar(rand, (colX[0] + colX[1]) / 2, colY(j), rand() < 0.6 ? 0 : PI));
  }
  return {
    id, title, description, difficulty,
    bounds: { x: X0, y: 0, w: LW - X0, h: H },
    bg: C.grass,
    start,
    targets,
    obstacles,
    scenery,
  };
}

// ---------------------------------------------------------------- list

const ALL = [
  angledScenario({
    id: 'diagonal-45', title: 'Diagonal 45°', difficulty: 'Easy',
    description: 'Angled bays — turn in forward at 45°.',
    alphaDeg: -45, entry: 'forward', targetIndex: 4, seed: 31,
  }),
  angledScenario({
    id: 'diagonal-60-reverse', title: 'Diagonal 60°, reverse', difficulty: 'Medium',
    description: 'Pass the free bay, then reverse into it at 60°.',
    alphaDeg: -120, entry: 'reverse', targetIndex: 5, seed: 37,
  }),
  turnAroundScenario({
    id: 'turn-around-empty', title: 'Turn around', difficulty: 'Easy',
    description: 'Turn around on an empty street and drive back to the box in the opposite lane. The sidewalks are fair game.',
    noCars: true, seed: 23, // same street as "Two-point turn", without the parked cars
  }),
  turnAroundScenario({
    id: 'two-point-turn', title: 'Two-point turn', difficulty: 'Medium',
    description: 'Turn around on a street with parked cars. Use the gaps to turn with a single reverse, then drive back to the box.',
    parallelLayout: { gap: 5.8, gapStart: 17 }, seed: 23, // same cars as "Tight parallel"
  }),
  turnAroundScenario({
    id: 'multi-point-turn', title: 'Multi-point turn', difficulty: 'Hard',
    description: 'Turn around on a street lined with parked cars. The gaps are too small to use, so it takes several shunts.',
    fitRows: true, length: 28.5, spacing: [1.1, 1.6], seed: 43,
  }),
  lotScenario({
    id: 'perpendicular-reverse', title: 'Reverse into a bay', difficulty: 'Medium',
    description: 'Back into the free bay between two parked cars.',
    target: { row: 'top', index: 5, heading: PI / 2 }, extraEmpty: ['bottom2'], seed: 5,
  }),
  lotScenario({
    id: 'perpendicular-forward', title: 'Nose-in bay', difficulty: 'Easy',
    description: 'Drive forward into the free bay on your right.',
    target: { row: 'bottom', index: 6, heading: PI / 2 }, extraEmpty: ['top1'], seed: 9,
  }),
  streetScenario({
    id: 'parallel-forward', title: 'Forward parallel', difficulty: 'Easy',
    description: 'Drive forward into the gap. You can run your wheels over the curb and sidewalk to swing in without reversing.',
    gap: 8.0, gapStart: 16, dropNeighbours: true, seed: 11,
  }),
  streetScenario({
    id: 'parallel-easy', title: 'Parallel parking', difficulty: 'Medium',
    description: 'Reverse into the gap between two cars along the curb.',
    gap: 7.0, gapStart: 16, seed: 11,
  }),
  streetScenario({
    id: 'parallel-tight', title: 'Tight parallel', difficulty: 'Hard',
    description: 'A gap only a little longer than your car. Expect a few shunts.',
    gap: 5.5, gapStart: 17, seed: 23,
  }),
  carParkScenario({
    id: 'carpark-exit', title: 'Leave the car park', difficulty: 'Medium',
    description: 'Pull out of your bay, turn right, U-turn into the next aisle and drive to the exit box.',
    mode: 'exit', seed: 101,
  }),
  carParkScenario({
    id: 'carpark-find-slot', title: 'Find a free bay', difficulty: 'Medium',
    description: 'Find any of the three free bays in the busy car park and park in it.',
    mode: 'find', seed: 202,
  }),
];

// Minimum number of reversals for a perfect (★) run – estimated, not computed.
const PAR = {
  'diagonal-45': 0,
  'diagonal-60-reverse': 1,
  'turn-around-empty': 0,
  'two-point-turn': 2,
  'multi-point-turn': 4,
  'perpendicular-forward': 0,
  'perpendicular-reverse': 1,
  'parallel-forward': 0,
  'parallel-easy': 1,
  'parallel-tight': 2,
  'carpark-exit': 2,
  'carpark-find-slot': 2,
};

/** Scenarios grouped by theme; levels go from easier to harder. */
export const GROUPS = [
  { id: 'diagonal', title: 'Diagonal parking', description: 'Angled bays, forward and in reverse.', levels: ['diagonal-45', 'diagonal-60-reverse'] },
  { id: 'turn-around', title: 'Turning around', description: 'Turn around on a street lined with parked cars.', levels: ['turn-around-empty', 'two-point-turn', 'multi-point-turn'] },
  { id: 'perpendicular', title: 'Perpendicular parking', description: 'Bays at right angles to the aisle, nose-in and reversing.', levels: ['perpendicular-forward', 'perpendicular-reverse'] },
  { id: 'parallel', title: 'Parallel parking', description: 'Park in a gap along the curb, forward and in reverse.', levels: ['parallel-forward', 'parallel-easy', 'parallel-tight'] },
  { id: 'car-park', title: 'Car park', description: 'Find your way around a tight, busy car park.', levels: ['carpark-exit', 'carpark-find-slot'] },
];

/** All scenarios in play order (group by group). */
export const SCENARIOS = GROUPS.flatMap((g) => g.levels.map((id) => {
  const s = ALL.find((x) => x.id === id);
  s.group = g.id;
  s.par = PAR[id];
  return s;
}));

export function getGroup(id) {
  return GROUPS.find((g) => g.id === id) || null;
}

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || null;
}

export function nextScenario(id) {
  const i = SCENARIOS.findIndex((s) => s.id === id);
  return i >= 0 && i < SCENARIOS.length - 1 ? SCENARIOS[i + 1] : null;
}

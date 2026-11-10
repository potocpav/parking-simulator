// Oriented-rectangle geometry. A rect is {x, y, hw, hh, angle}: centre, half extents
// (hw along the angle direction, hh perpendicular), rotation in radians.

export function corners(r) {
  const c = Math.cos(r.angle), s = Math.sin(r.angle);
  const ax = c * r.hw, ay = s * r.hw;   // half-length axis
  const bx = -s * r.hh, by = c * r.hh;  // half-width axis
  return [
    [r.x + ax + bx, r.y + ay + by],
    [r.x + ax - bx, r.y + ay - by],
    [r.x - ax - bx, r.y - ay - by],
    [r.x - ax + bx, r.y - ay + by],
  ];
}

export function boundingRadius(r) {
  return Math.hypot(r.hw, r.hh);
}

function projectRadius(r, axX, axY) {
  const c = Math.cos(r.angle), s = Math.sin(r.angle);
  return r.hw * Math.abs(c * axX + s * axY) + r.hh * Math.abs(-s * axX + c * axY);
}

/** Separating-axis test for two oriented rectangles. */
export function rectsOverlap(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const rr = boundingRadius(a) + boundingRadius(b);
  if (dx * dx + dy * dy > rr * rr) return false;
  const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2];
  for (const ang of axes) {
    const ax = Math.cos(ang), ay = Math.sin(ang);
    const dist = Math.abs(dx * ax + dy * ay);
    if (dist > projectRadius(a, ax, ay) + projectRadius(b, ax, ay)) return false;
  }
  return true;
}

export function pointInRect(px, py, r, margin = 0) {
  const c = Math.cos(r.angle), s = Math.sin(r.angle);
  const dx = px - r.x, dy = py - r.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) <= r.hw + margin && Math.abs(ly) <= r.hh + margin;
}

function segIntersect(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
}

/** Rough contact point of two overlapping rects: mean of corners inside the other + edge crossings. */
export function contactPoint(a, b) {
  const ca = corners(a), cb = corners(b);
  const pts = [];
  for (const p of ca) if (pointInRect(p[0], p[1], b)) pts.push(p);
  for (const p of cb) if (pointInRect(p[0], p[1], a)) pts.push(p);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const q = segIntersect(ca[i], ca[(i + 1) % 4], cb[j], cb[(j + 1) % 4]);
      if (q) pts.push(q);
    }
  }
  if (!pts.length) return [(a.x + b.x) / 2, (a.y + b.y) / 2];
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p[0]; sy += p[1]; }
  return [sx / pts.length, sy / pts.length];
}

/** Distance along a ray (unit direction) to a rect, or Infinity if missed within maxT. */
export function rayRect(ox, oy, dx, dy, r, maxT) {
  const c = Math.cos(r.angle), s = Math.sin(r.angle);
  const rx = ox - r.x, ry = oy - r.y;
  const lox = rx * c + ry * s, loy = -rx * s + ry * c;
  const ldx = dx * c + dy * s, ldy = -dx * s + dy * c;
  let tmin = -Infinity, tmax = Infinity;
  const slab = (o, d, h) => {
    if (Math.abs(d) < 1e-9) return Math.abs(o) <= h;
    let t1 = (-h - o) / d, t2 = (h - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };
  if (!slab(lox, ldx, r.hw) || !slab(loy, ldy, r.hh)) return Infinity;
  if (tmax < 0) return Infinity;
  const t = Math.max(0, tmin);
  return t <= maxT ? t : Infinity;
}

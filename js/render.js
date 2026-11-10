// Canvas drawing. After applyCamera() the context works in world metres.
import { CAR } from './car.js';

// ---------------------------------------------------------------- camera

export function fitCamera(bounds, W, H, padTop = 0, padBottom = 0) {
  const m = 0.4;
  const availH = Math.max(50, H - padTop - padBottom);
  const ppm = Math.min(W / (bounds.w + 2 * m), availH / (bounds.h + 2 * m));
  return {
    ppm,
    cx: bounds.x + bounds.w / 2,
    cy: bounds.y + bounds.h / 2 - (padTop - padBottom) / 2 / ppm,
  };
}

export function followZoom(W, H) {
  return Math.max(14, Math.min(42, Math.min(W, H) / 21));
}

/** Clamp a follow-camera centre so the view stays inside the bounds where possible. */
export function clampCamera(cam, bounds, W, H) {
  const hw = W / 2 / cam.ppm, hh = H / 2 / cam.ppm;
  const clampAxis = (c, lo, size, half) =>
    size <= 2 * half ? lo + size / 2 : Math.min(lo + size - half, Math.max(lo + half, c));
  cam.cx = clampAxis(cam.cx, bounds.x, bounds.w, hw);
  cam.cy = clampAxis(cam.cy, bounds.y, bounds.h, hh);
  return cam;
}

export function applyCamera(ctx, cam, W, H, dpr) {
  const k = dpr * cam.ppm;
  ctx.setTransform(k, 0, 0, k, dpr * (W / 2 - cam.cx * cam.ppm), dpr * (H / 2 - cam.cy * cam.ppm));
}

// ---------------------------------------------------------------- helpers

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  r = f(r); g = f(g); b = f(b);
  return `rgb(${r},${g},${b})`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function withRect(ctx, o, fn) {
  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.angle) ctx.rotate(o.angle);
  fn(o.w / 2, o.h / 2);
  ctx.restore();
}

function drawText(ctx, text, x, y, size, color, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(size / 100, size / 100);
  ctx.font = 'bold 100px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------- scenery

function drawTree(ctx, t) {
  const { x, y, r } = t;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.arc(x + r * 0.25, y + r * 0.3, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f5d27';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  const seed = Math.abs(Math.sin(x * 12.9898 + y * 78.233)) * 1000;
  ctx.fillStyle = '#3f7a32';
  for (let i = 0; i < 5; i++) {
    const a = seed + i * 1.3;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(160,210,120,0.35)';
  ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
}

function drawArrow(ctx, a) {
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(a.angle);
  const k = (a.len || 2.4) / 2.4;
  ctx.scale(k, k);
  ctx.fillStyle = 'rgba(236,239,241,0.75)';
  ctx.beginPath();
  ctx.moveTo(-1.2, -0.12); ctx.lineTo(0.35, -0.12); ctx.lineTo(0.35, -0.4);
  ctx.lineTo(1.2, 0); ctx.lineTo(0.35, 0.4); ctx.lineTo(0.35, 0.12); ctx.lineTo(-1.2, 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSceneryItem(ctx, s) {
  switch (s.type) {
    case 'rect':
      withRect(ctx, s, (hw, hh) => {
        ctx.fillStyle = s.fill;
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
      });
      break;
    case 'line':
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    case 'tree': drawTree(ctx, s); break;
    case 'arrow': drawArrow(ctx, s); break;
    case 'text': drawText(ctx, s.text, s.x, s.y, s.size, s.color, s.angle || 0); break;
  }
}

export function drawScenery(ctx, scenario, layer) {
  for (const s of scenario.scenery) {
    if ((s.layer || 'ground') === layer) drawSceneryItem(ctx, s);
  }
}

export function drawGround(ctx, scenario) {
  const b = scenario.bounds;
  ctx.fillStyle = scenario.bg;
  ctx.fillRect(b.x - 200, b.y - 200, b.w + 400, b.h + 400);
}

// ---------------------------------------------------------------- obstacles

function drawObstacle(ctx, o) {
  switch (o.type) {
    case 'car':
      drawCar(ctx, { x: o.x, y: o.y, angle: o.angle, length: o.w, width: o.h, color: o.color });
      break;
    case 'curb':
      withRect(ctx, o, (hw, hh) => {
        ctx.fillStyle = '#cfcac0';
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        ctx.strokeStyle = '#8f8a80';
        ctx.lineWidth = 0.04;
        ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
      });
      break;
    case 'wall':
      withRect(ctx, o, (hw, hh) => {
        ctx.fillStyle = '#7a7d82';
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        ctx.strokeStyle = '#a9adb2';
        ctx.lineWidth = 0.06;
        ctx.strokeRect(-hw + 0.03, -hh + 0.03, hw * 2 - 0.06, hh * 2 - 0.06);
      });
      break;
    case 'island':
      withRect(ctx, o, (hw, hh) => {
        roundRectPath(ctx, -hw, -hh, hw * 2, hh * 2, 0.6);
        ctx.fillStyle = '#cfcac0';
        ctx.fill();
        roundRectPath(ctx, -hw + 0.2, -hh + 0.2, hw * 2 - 0.4, hh * 2 - 0.4, 0.45);
        ctx.fillStyle = '#5f8a43';
        ctx.fill();
      });
      break;
    case 'hedge':
      withRect(ctx, o, (hw, hh) => {
        roundRectPath(ctx, -hw, -hh, hw * 2, hh * 2, 0.5);
        ctx.fillStyle = '#2f5d27';
        ctx.fill();
        ctx.strokeStyle = '#3f7a32';
        ctx.lineWidth = 0.3;
        ctx.stroke();
      });
      break;
    case 'post':
      withRect(ctx, o, (hw, hh) => {
        ctx.fillStyle = '#ffca28';
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 0.08;
        ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
        ctx.beginPath(); ctx.moveTo(-hw, -hh); ctx.lineTo(hw, hh); ctx.stroke();
      });
      break;
    default:
      break; // 'bound' – invisible
  }
}

export function drawObstacles(ctx, scenario) {
  for (const o of scenario.obstacles) drawObstacle(ctx, o);
}

/** Scratches and a small dent where a parked car was bumped (clipped to its body). */
export function drawScars(ctx, scenario, scars) {
  for (const sc of scars) {
    const o = scenario.obstacles[sc.index];
    if (!o) continue;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle || 0);
    ctx.beginPath();
    ctx.rect(-o.w / 2, -o.h / 2, o.w, o.h);
    ctx.clip();
    ctx.translate(sc.lx, sc.ly);
    ctx.rotate(sc.along);
    const L = sc.size;
    // dent / scuffed paint
    ctx.fillStyle = 'rgba(20,20,20,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.5, L * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    // scratches: light (bare metal) and dark (paint transfer) strokes along the panel
    let r = sc.seed;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const off = (rnd() - 0.5) * L * 0.5;
      const len = L * (0.4 + rnd() * 0.6);
      const x0 = (rnd() - 0.5) * L * 0.4 - len / 2;
      const tilt = (rnd() - 0.5) * 0.25;
      ctx.strokeStyle = i % 2 ? 'rgba(240,240,240,0.95)' : 'rgba(15,15,15,0.85)';
      ctx.lineWidth = 0.045 + rnd() * 0.035;
      ctx.beginPath();
      ctx.moveTo(x0, off);
      ctx.lineTo(x0 + len, off + len * tilt);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- car

/**
 * Draw a top-down hatchback centred on (x, y), nose pointing along `angle`.
 * opts: length, width, color, steer (front-wheel angle), brake, reverse, player
 */
export function drawCar(ctx, o) {
  const l = o.length || CAR.length, w = o.width || CAR.width;
  const hl = l / 2, hw = w / 2;
  const k = l / CAR.length;
  const color = o.color || '#f4f5f7';
  const steer = o.steer || 0;

  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.angle);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRectPath(ctx, -hl + 0.06, -hw + 0.12, l, w, 0.35);
  ctx.fill();

  // Tyres (under the body, a little outboard so steered front wheels show)
  const rearX = -hl + CAR.rearOverhang * k;
  const frontX = rearX + CAR.wheelbase * k;
  const ty = hw - 0.07;
  const tire = (x, y, a) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = '#151515';
    roundRectPath(ctx, -CAR.tireLen / 2, -CAR.tireWid / 2, CAR.tireLen, CAR.tireWid, 0.06);
    ctx.fill();
    ctx.strokeStyle = '#4a4a4a';
    ctx.lineWidth = 0.025;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 0.11, -CAR.tireWid / 2 + 0.02);
      ctx.lineTo(i * 0.11, CAR.tireWid / 2 - 0.02);
      ctx.stroke();
    }
    ctx.restore();
  };
  tire(rearX, -ty, 0);
  tire(rearX, ty, 0);
  tire(frontX, -ty, steer);
  tire(frontX, ty, steer);

  // Body
  ctx.beginPath();
  ctx.moveTo(-hl + 0.25, -hw);
  ctx.lineTo(hl - 0.75, -hw);
  ctx.quadraticCurveTo(hl - 0.08, -hw + 0.02, hl - 0.02, -hw + 0.42);
  ctx.quadraticCurveTo(hl + 0.04, 0, hl - 0.02, hw - 0.42);
  ctx.quadraticCurveTo(hl - 0.08, hw - 0.02, hl - 0.75, hw);
  ctx.lineTo(-hl + 0.25, hw);
  ctx.quadraticCurveTo(-hl, hw, -hl, hw - 0.25);
  ctx.lineTo(-hl, -hw + 0.25);
  ctx.quadraticCurveTo(-hl, -hw, -hl + 0.25, -hw);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -hw, 0, hw);
  g.addColorStop(0, shade(color, -0.18));
  g.addColorStop(0.25, color);
  g.addColorStop(0.75, color);
  g.addColorStop(1, shade(color, -0.18));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.45);
  ctx.lineWidth = 0.035;
  ctx.stroke();

  // Mirrors
  ctx.fillStyle = color;
  ctx.strokeStyle = shade(color, -0.45);
  ctx.lineWidth = 0.025;
  for (const s of [-1, 1]) {
    roundRectPath(ctx, hl * 0.26, s > 0 ? hw - 0.02 : -hw - 0.16, 0.16, 0.18, 0.05);
    ctx.fill();
    ctx.stroke();
  }

  // Glass house
  const cabR = -hl * 0.74, cabF = hl * 0.44;
  ctx.fillStyle = '#1d2733';
  ctx.beginPath();
  ctx.moveTo(cabR + 0.15, -hw + 0.13);
  ctx.lineTo(cabF - 0.1, -hw + 0.17);
  ctx.quadraticCurveTo(cabF + 0.1, 0, cabF - 0.1, hw - 0.17);
  ctx.lineTo(cabR + 0.15, hw - 0.13);
  ctx.quadraticCurveTo(cabR - 0.05, 0, cabR + 0.15, -hw + 0.13);
  ctx.closePath();
  ctx.fill();

  // Roof
  const roofR = -hl * 0.55, roofF = hl * 0.12;
  const rg = ctx.createLinearGradient(0, -hw, 0, hw);
  rg.addColorStop(0, shade(color, -0.1));
  rg.addColorStop(0.5, shade(color, 0.08));
  rg.addColorStop(1, shade(color, -0.1));
  ctx.fillStyle = rg;
  roundRectPath(ctx, roofR, -hw + 0.24, roofF - roofR, w - 0.48, 0.18);
  ctx.fill();

  // Glass reflections
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(roofF + 0.18, -hw + 0.35); ctx.lineTo(cabF - 0.12, -hw + 0.55);
  ctx.stroke();

  // Bonnet creases
  ctx.strokeStyle = shade(color, -0.25);
  ctx.lineWidth = 0.02;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cabF + 0.05, s * (hw - 0.4));
    ctx.quadraticCurveTo(hl - 0.5, s * (hw - 0.35), hl - 0.25, s * (hw - 0.3));
    ctx.stroke();
  }

  // Head lights
  ctx.fillStyle = '#fff8d6';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 0.02;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(hl - 0.17, s * (hw - 0.3), 0.08, 0.2, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Tail lights
  for (const s of [-1, 1]) {
    ctx.fillStyle = o.brake ? '#ff3b3b' : '#9e1c1c';
    roundRectPath(ctx, -hl + 0.02, s > 0 ? hw - 0.5 : -hw + 0.1, 0.12, 0.4, 0.04);
    ctx.fill();
    if (o.brake) {
      ctx.fillStyle = 'rgba(255,40,40,0.28)';
      ctx.beginPath();
      ctx.arc(-hl - 0.05, s * (hw - 0.3), 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    if (o.reverse) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-hl + 0.02, s * (hw - 0.62) - 0.06, 0.1, 0.12);
    }
  }
  if (o.reverse) {
    const rg2 = ctx.createRadialGradient(-hl, 0, 0.1, -hl, 0, 1.6);
    rg2.addColorStop(0, 'rgba(255,255,240,0.22)');
    rg2.addColorStop(1, 'rgba(255,255,240,0)');
    ctx.fillStyle = rg2;
    ctx.beginPath();
    ctx.arc(-hl, 0, 1.6, Math.PI / 2, Math.PI * 1.5);
    ctx.fill();
  }

  ctx.restore();
}

// ---------------------------------------------------------------- targets / overlays

export function drawTargets(ctx, targets, status = {}, time = 0) {
  targets.forEach((t, i) => {
    const st = status.index === i ? status : null;
    withRect(ctx, t, (hw, hh) => {
      let fill = 'rgba(255,213,79,0.10)', stroke = '#ffd54f';
      if (st && st.inside && st.ok) { fill = 'rgba(102,187,106,0.35)'; stroke = '#66bb6a'; }
      else if (st && st.inside) { fill = 'rgba(255,167,38,0.22)'; stroke = '#ffa726'; }
      ctx.fillStyle = fill;
      ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.12;
      ctx.setLineDash([0.5, 0.3]);
      ctx.lineDashOffset = -time * 0.6;
      ctx.strokeRect(-hw + 0.06, -hh + 0.06, hw * 2 - 0.12, hh * 2 - 0.12);
      ctx.setLineDash([]);
    });
    // Required heading chevrons (if exactly one direction is allowed)
    if (t.headings.length === 1 && !t.label && !(st && st.inside)) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.headings[0]);
      ctx.strokeStyle = 'rgba(255,213,79,0.7)';
      ctx.lineWidth = 0.14;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const dx of [-0.35, 0.25]) {
        ctx.beginPath();
        ctx.moveTo(dx - 0.3, -0.5); ctx.lineTo(dx + 0.15, 0); ctx.lineTo(dx - 0.3, 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (t.label) {
      drawText(ctx, t.label, t.x, t.y, 0.9, 'rgba(255,213,79,0.85)', 0);
    }
    if (st && st.progress > 0) {
      ctx.strokeStyle = '#66bb6a';
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 0.7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * st.progress);
      ctx.stroke();
    }
  });
}

/** Stroke tyre paths. samples[i] = [FL, FR, RL, RR]; `wheels` picks which tyres to draw. */
export function drawPaths(ctx, samples, color, alpha, width, wheels = [0, 1, 2, 3]) {
  if (!samples || samples.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const w of wheels) {
    ctx.beginPath();
    samples.forEach((s, i) => (i ? ctx.lineTo(s[w][0], s[w][1]) : ctx.moveTo(s[w][0], s[w][1])));
    ctx.stroke();
  }
  ctx.restore();
}

export function drawCrashMarkers(ctx, markers, time) {
  for (const m of markers) {
    const a = Math.max(0, Math.min(1, m.life));
    const pulse = 0.5 + 0.5 * Math.sin(time * 8);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(244,67,54,0.28)';
    ctx.beginPath(); ctx.arc(m.x, m.y, 0.45 + pulse * 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#f44336';
    ctx.lineWidth = 0.12;
    ctx.beginPath(); ctx.arc(m.x, m.y, 0.55 + pulse * 0.2, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.arc(m.x, m.y, 0.85 + pulse * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

export function sensorColor(d) {
  if (d < 0.3) return '#f44336';
  if (d < 0.6) return '#ff9800';
  if (d < 1.0) return '#ffeb3b';
  return '#8bc34a';
}

export const SENSOR_RANGE = 1.5;

/**
 * Parking-sensor step for a distance, shared by the visuals and the beeps:
 * 0 = out of range, 1 = slow (1.0–1.5 m), 2 = medium (0.6–1.0 m), 3 = fast (0.3–0.6 m), 4 = continuous (< 0.3 m).
 */
export function sensorLevel(d) {
  if (!(d < SENSOR_RANGE)) return 0;
  return d < 0.3 ? 4 : d < 0.6 ? 3 : d < 1.0 ? 2 : 1;
}
const ZONE_SPANS = [[-62, -22], [-19, 19], [22, 62]];

/** Sensor arcs around the car body (centre pose). sensors = {front:[l,c,r], rear:[l,c,r]} */
export function drawSensorArcs(ctx, body, sensors) {
  if (!sensors) return;
  const hl = CAR.length / 2;
  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.rotate(body.angle);
  ctx.lineCap = 'butt';
  for (const [side, dir] of [['front', 1], ['rear', -1]]) {
    const cx = dir * (hl - 1.2);
    sensors[side].forEach((d, i) => {
      if (!(d < SENSOR_RANGE)) return;
      let [a0, a1] = ZONE_SPANS[i];
      a0 *= Math.PI / 180; a1 *= Math.PI / 180;
      if (dir < 0) { const t = a0; a0 = Math.PI - a1; a1 = Math.PI - t; }
      ctx.strokeStyle = sensorColor(d);
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 0.12;
      const bars = sensorLevel(d);
      for (let b = 0; b < bars; b++) {
        ctx.beginPath();
        ctx.arc(cx, 0, 1.55 + b * 0.18, a0, a1);
        ctx.stroke();
      }
    });
  }
  ctx.restore();
}

// ---------------------------------------------------------------- full static scene (thumbnails)

export function renderPreview(canvas, scenario, startBody) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || 320, H = canvas.clientHeight || 200;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  const cam = fitCamera(scenario.bounds, W, H);
  applyCamera(ctx, cam, W, H, dpr);
  drawGround(ctx, scenario);
  drawScenery(ctx, scenario, 'ground');
  drawTargets(ctx, scenario.targets);
  drawObstacles(ctx, scenario);
  drawScenery(ctx, scenario, 'top');
  drawCar(ctx, { ...startBody, color: '#f4f5f7' });
}

// HUD widget drawn on a small dedicated canvas (parking sensors).
import { CAR } from './car.js';
import { sensorColor, sensorLevel } from './render.js';

function prep(canvas) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  return { ctx, W, H };
}

/** Mini top-down car with sensor arcs. */
export function drawSensorWidget(canvas, sensors) {
  const { ctx, W, H } = prep(canvas);
  const s = Math.min(W / 3.6, H / 6.4); // px per metre
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 2); // nose up
  ctx.scale(s, s);
  const hl = CAR.length / 2, hw = CAR.width / 2;
  ctx.fillStyle = '#e8eaed';
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(-hl, -hw, hl * 2, hw * 2, 0.35) : ctx.rect(-hl, -hw, hl * 2, hw * 2);
  ctx.fill();
  ctx.fillStyle = '#26323f';
  ctx.fillRect(-hl * 0.7, -hw + 0.18, hl * 1.1, hw * 2 - 0.36);
  ctx.fillStyle = '#e8eaed';
  ctx.fillRect(-hl * 0.5, -hw + 0.28, hl * 0.62, hw * 2 - 0.56);

  const spans = [[-62, -22], [-19, 19], [22, 62]];
  for (const [side, dir] of [['front', 1], ['rear', -1]]) {
    const cx = dir * (hl - 1.2);
    sensors[side].forEach((d, i) => {
      let [a0, a1] = spans[i].map((a) => (a * Math.PI) / 180);
      if (dir < 0) { const t = a0; a0 = Math.PI - a1; a1 = Math.PI - t; }
      const bars = sensorLevel(d);
      const near = bars > 0;
      ctx.lineWidth = 0.16;
      for (let b = 0; b < 4; b++) {
        ctx.strokeStyle = near && b < bars ? sensorColor(d) : 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.arc(cx, 0, 1.5 + (3 - b) * 0.22, a0 + 0.05, a1 - 0.05);
        ctx.stroke();
      }
    });
  }
  ctx.restore();
}

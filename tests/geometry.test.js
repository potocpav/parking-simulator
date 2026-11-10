import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAR, advance, bodyRect, centerToRear } from '../js/car.js';
import { rectsOverlap, pointInRect, rayRect, contactPoint } from '../js/collision.js';
import { SCENARIOS } from '../js/scenarios.js';

const toRect = (o) => ({ x: o.x, y: o.y, hw: o.w / 2, hh: o.h / 2, angle: o.angle || 0 });

test('SAT overlap basics', () => {
  const a = { x: 0, y: 0, hw: 2, hh: 1, angle: 0 };
  assert.equal(rectsOverlap(a, { x: 3.9, y: 0, hw: 2, hh: 1, angle: 0 }), true);
  assert.equal(rectsOverlap(a, { x: 4.1, y: 0, hw: 2, hh: 1, angle: 0 }), false);
  assert.equal(rectsOverlap(a, { x: 0, y: 2.5, hw: 2, hh: 1, angle: Math.PI / 4 }), true);
  assert.equal(rectsOverlap(a, { x: 3.5, y: 2.5, hw: 1, hh: 0.2, angle: Math.PI / 4 }), false);
  const [cx, cy] = contactPoint(a, { x: 3.9, y: 0, hw: 2, hh: 1, angle: 0 });
  assert.ok(Math.abs(cx - 1.95) < 0.1 && Math.abs(cy) < 1e-9);
});

test('ray / point helpers', () => {
  const r = { x: 5, y: 0, hw: 1, hh: 1, angle: 0 };
  assert.ok(Math.abs(rayRect(0, 0, 1, 0, r, 10) - 4) < 1e-9);
  assert.equal(rayRect(0, 0, -1, 0, r, 10), Infinity);
  assert.equal(pointInRect(5.5, 0.5, r), true);
});

test('turning circle matches L / tan(delta)', () => {
  const d = CAR.maxSteer;
  const R = CAR.wheelbase / Math.tan(d);
  let p = { x: 0, y: 0, theta: 0 };
  for (let i = 0; i < 1000; i++) p = advance(p, (Math.PI * R) / 1000, d);
  // half circle to the right (y down): ends at (0, 2R) heading π
  assert.ok(Math.abs(p.x) < 1e-6 && Math.abs(p.y - 2 * R) < 1e-6);
});

for (const s of SCENARIOS) {
  test(`scenario ${s.id} is consistent`, () => {
    const obs = s.obstacles.map(toRect);
    const car = bodyRect(centerToRear(s.start));
    obs.forEach((o, i) => assert.equal(rectsOverlap(car, o), false, `start overlaps obstacle ${i} (${s.obstacles[i].type})`));
    for (const t of s.targets) {
      const tr = toRect(t);
      obs.forEach((o, i) => {
        if (s.obstacles[i].type === 'car') assert.equal(rectsOverlap(tr, o), false, `target overlaps car ${i}`);
      });
      // a car centred in the target with an allowed heading must count as inside
      const pose = bodyRect(centerToRear({ x: t.x, y: t.y, angle: t.headings[0] }));
      const c = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => {
        const ca = Math.cos(pose.angle), sa = Math.sin(pose.angle);
        return [pose.x + a * pose.hw * ca - b * pose.hh * sa, pose.y + a * pose.hw * sa + b * pose.hh * ca];
      });
      assert.ok(c.every(([x, y]) => pointInRect(x, y, tr)), 'car does not fit target');
      obs.forEach((o, i) => assert.equal(rectsOverlap(pose, o), false, `parked pose overlaps ${s.obstacles[i].type} ${i}`));
    }
    const cars = s.obstacles.filter((o) => o.type === 'car').map(toRect);
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        assert.equal(rectsOverlap(cars[i], cars[j]), false, `parked cars ${i} and ${j} overlap`);
      }
    }
  });
}

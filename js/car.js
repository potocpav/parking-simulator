// Player car constants and kinematics (kinematic bicycle model, rear-axle reference).
// World units are metres; x → right, y → down (canvas convention), angles in radians,
// positive angle = clockwise on screen. Positive steer = turn right.

const D2R = Math.PI / 180;

export const CAR = {
  length: 4.38,        // Ford Focus-ish hatchback
  width: 1.83,
  wheelbase: 2.70,
  track: 1.56,
  rearOverhang: 0.78,
  maxSteer: 35 * D2R,  // front-wheel angle at full lock
  steerRate: 60 * D2R, // front-wheel angle change per second while a key is held
  autoCenterPerMetre: 12 * D2R, // self-centring per metre driven with no steering input (~3 m from full lock)
  maxFwd: 5.0,         // m/s (18 km/h)
  maxRev: 3.6,         // m/s (13 km/h)
  accel: 3.2,          // m/s²
  brake: 9.0,          // m/s² when pressing the opposite pedal
  coast: 2.8,          // m/s² rolling deceleration with no pedal
  tireLen: 0.64,
  tireWid: 0.22,
};
// Distance from the rear axle to the centre of the body.
CAR.centerOffset = CAR.length / 2 - CAR.rearOverhang;

/** Convert a body-centre pose {x, y, angle} to a rear-axle pose {x, y, theta}. */
export function centerToRear({ x, y, angle }) {
  const c = CAR.centerOffset;
  return { x: x - c * Math.cos(angle), y: y - c * Math.sin(angle), theta: angle };
}

/** Body rectangle (centre + half extents + angle) for a rear-axle pose. */
export function bodyRect(p) {
  const c = CAR.centerOffset;
  return {
    x: p.x + c * Math.cos(p.theta),
    y: p.y + c * Math.sin(p.theta),
    hw: CAR.length / 2,
    hh: CAR.width / 2,
    angle: p.theta,
  };
}

/** Move the rear axle by arc length ds with front-wheel angle delta (exact arc). */
export function advance(p, ds, delta) {
  if (Math.abs(delta) < 1e-6) {
    return { x: p.x + ds * Math.cos(p.theta), y: p.y + ds * Math.sin(p.theta), theta: p.theta };
  }
  const R = CAR.wheelbase / Math.tan(delta);
  const nt = p.theta + ds / R;
  return {
    x: p.x + R * (Math.sin(nt) - Math.sin(p.theta)),
    y: p.y - R * (Math.cos(nt) - Math.cos(p.theta)),
    theta: nt,
  };
}

/** World positions of the four tyre centres: [frontLeft, frontRight, rearLeft, rearRight]. */
export function wheelPositions(p) {
  const ux = Math.cos(p.theta), uy = Math.sin(p.theta);
  const nx = -uy, ny = ux; // car's right side
  const t = CAR.track / 2, L = CAR.wheelbase;
  const fx = p.x + L * ux, fy = p.y + L * uy;
  return [
    [fx - t * nx, fy - t * ny],
    [fx + t * nx, fy + t * ny],
    [p.x - t * nx, p.y - t * ny],
    [p.x + t * nx, p.y + t * ny],
  ];
}

/** Predict tyre paths for `dist` metres (negative = reversing) at a fixed steer angle. */
export function predictPath(p, delta, dist, step = 0.1) {
  const n = Math.max(1, Math.round(Math.abs(dist) / step));
  const ds = dist / n;
  const out = [wheelPositions(p)];
  let q = p;
  for (let i = 0; i < n; i++) {
    q = advance(q, ds, delta);
    out.push(wheelPositions(q));
  }
  return out;
}

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

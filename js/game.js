// Game state, fixed-timestep simulation and world rendering.
import { CAR, advance, bodyRect, centerToRear, predictPath, wheelPositions, wrapAngle } from './car.js';
import { contactPoint, corners, pointInRect, rayRect, rectsOverlap } from './collision.js';
import {
  applyCamera, drawCar, drawCrashMarkers, drawGround, drawObstacles, drawPaths, drawScar, drawScars, lightPositions,
  drawScenery, drawSensorArcs, drawTargets, followZoom, SENSOR_RANGE,
} from './render.js';

const DT = 1 / 60;
const HOLD_TIME = 1.0;      // seconds to hold a valid pose before success
const STOP_SPEED = 0.05;
const TRAIL_STEP = 0.1;
const TRAIL_MAX = 8000;
const PREDICT_DIST = 1.5;
const TOP_BAR = 56;
const TRUNK = 0.6;                         // tree trunk collision size (m)
const DRIVABLE = new Set(['curb', 'island']); // obstacle types the car can drive over

/**
 * A scar for a hit at world point (x, y) on rect o ({ x, y, hw, hh, angle }): stored in o's local
 * frame, snapped just inside the nearest body edge, scratches running along that edge.
 */
function makeScar(o, x, y, speed) {
  const c = Math.cos(o.angle), s = Math.sin(o.angle);
  const dx = x - o.x, dy = y - o.y;
  let lx = dx * c + dy * s, ly = -dx * s + dy * c;
  let along;
  if (o.hw - Math.abs(lx) < o.hh - Math.abs(ly)) {
    lx = Math.sign(lx || 1) * (o.hw - 0.18);
    ly = Math.max(-o.hh + 0.1, Math.min(o.hh - 0.1, ly));
    along = Math.PI / 2;
  } else {
    ly = Math.sign(ly || 1) * (o.hh - 0.16);
    lx = Math.max(-o.hw + 0.1, Math.min(o.hw - 0.1, lx));
    along = 0;
  }
  return { lx, ly, along, size: Math.min(1.0, 0.55 + speed * 0.15), seed: Math.random() * 1000 };
}

/** Break every light of car-rect r ({ x, y, hw, hh, angle }) within 0.5 m of the hit at (x, y). */
function breakLights(r, x, y, set) {
  const c = Math.cos(r.angle), s = Math.sin(r.angle);
  const lx = (x - r.x) * c + (y - r.y) * s, ly = -(x - r.x) * s + (y - r.y) * c;
  for (const [id, [px, py]] of Object.entries(lightPositions(r.hw * 2, r.hh * 2))) {
    if (Math.hypot(lx - px, ly - py) < 0.5) set.add(id);
  }
}

const toRect = (o) => ({ x: o.x, y: o.y, hw: o.w / 2, hh: o.h / 2, angle: o.angle || 0, type: o.type });

// Parking sensor rays in body-local coordinates (x forward, y right).
function sensorRays() {
  const hl = CAR.length / 2, hw = CAR.width / 2, D = Math.PI / 180;
  const zone = (ox, oy, angles) => angles.map((a) => [ox, oy, a * D]);
  const front = [
    zone(hl - 0.15, -hw + 0.15, [-55, -30, -8]),
    zone(hl, 0, [-6, 0, 6]).concat([[hl, -0.45, 0], [hl, 0.45, 0]]),
    zone(hl - 0.15, hw - 0.15, [8, 30, 55]),
  ];
  const mirror = ([x, y, a]) => [-x, y, Math.PI - a];
  const rear = front.map((z) => z.map(mirror));
  return { front, rear };
}
const RAYS = sensorRays();

export class Game {
  constructor(canvas, input, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.hooks = hooks;
    this.settings = {};
    this.running = false;
    this.raf = 0;
    this.time = 0; // render clock
    this.loop = this.loop.bind(this);
  }

  load(scenario, settings) {
    this.scenario = scenario;
    this.settings = settings;
    const b = scenario.bounds, t = 2;
    const walls = [
      { type: 'bound', x: b.x + b.w / 2, y: b.y - t / 2, w: b.w + 2 * t, h: t },
      { type: 'bound', x: b.x + b.w / 2, y: b.y + b.h + t / 2, w: b.w + 2 * t, h: t },
      { type: 'bound', x: b.x - t / 2, y: b.y + b.h / 2, w: t, h: b.h + 2 * t },
      { type: 'bound', x: b.x + b.w + t / 2, y: b.y + b.h / 2, w: t, h: b.h + 2 * t },
    ];
    // Tree trunks are solid; the canopy is only drawn.
    const trunks = scenario.scenery
      .filter((s) => s.type === 'tree')
      .map((t) => ({ type: 'tree', x: t.x, y: t.y, w: TRUNK, h: TRUNK }));
    const all = [...scenario.obstacles, ...walls, ...trunks].map((o, i) => ({ ...toRect(o), idx: i }));
    // Curbs and kerbed islands can be driven over (a wheel thuds on each curb it crosses).
    this.obstacles = all.filter((o) => !DRIVABLE.has(o.type));
    // Each curb stone's raised side (local ±y) faces away from the map centre: that's the sidewalk.
    const cy = b.y + b.h / 2;
    this.curbZones = all.filter((o) => DRIVABLE.has(o.type)).map((o) => ({
      ...o, hw: o.hw + 0.02, hh: o.hh + 0.02, up: Math.sign(o.y - cy) || 1,
    }));
    this.targets = scenario.targets.map(toRect);
    this.reset();
  }


  reset() {
    this.pose = centerToRear(this.scenario.start);
    this.steer = 0;
    this.v = 0;
    this.braking = false;
    this.lastDir = 1;
    this.crashes = 0;
    this.reversals = 0; // direction changes of actual movement
    this.moveDir = 0;   // direction of the last actual movement (0 = not moved yet)
    this.markers = [];
    this.scars = []; // permanent scratches on bumped parked cars (cleared on reset)
    this.playerScars = []; // scratches on the player's car
    this.brokenLights = new Set();   // player's broken lights
    this.brokenParked = new Map();   // obstacle index → Set of broken light ids
    this.blockedDir = 0;
    this.distSinceBlock = 0;
    this.trail = [wheelPositions(this.pose)];
    this.wheelZones = wheelPositions(this.pose).map((w) => this.zonesAt(w));
    this.wheelPrev = null;
    this.trailAcc = 0;
    this.hold = 0;
    this.targetStatus = {};
    this.state = 'playing';
    this.cam = null;
    this.acc = 0;
    this.sensors = this.computeSensors();
    this.input.clear();
  }

  // ------------------------------------------------------------ lifecycle

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.fpsStart = 0;
    this.fpsFrames = 0;
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  loop(now) {
    if (!this.running) return;
    // Frames per second, averaged over half-second windows.
    this.fpsFrames = (this.fpsFrames || 0) + 1;
    if (!this.fpsStart) this.fpsStart = now;
    if (now - this.fpsStart >= 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsStart));
      this.fpsFrames = 0;
      this.fpsStart = now;
    }
    const frameDt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += frameDt;
    if (this.state === 'playing') {
      this.acc += frameDt;
      let n = 0;
      while (this.acc >= DT && n < 6) {
        this.step(DT);
        this.acc -= DT;
        n++;
      }
      if (n === 6) this.acc = 0;
    }
    this.updateMarkers(frameDt);
    this.sensors = this.computeSensors();
    this.render(frameDt);
    this.hooks.onFrame?.(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------ simulation

  step(dt) {
    const inp = this.input;
    const L = inp.left && !inp.right, R = inp.right && !inp.left;

    // Steering: constant angular rate while held. When released, the wheels self-centre
    // in proportion to the distance driven (not while standing still).
    if (L || R) {
      this.steer += (R ? 1 : -1) * CAR.steerRate * dt;
    } else {
      const d = CAR.autoCenterPerMetre * Math.abs(this.v) * dt;
      if (Math.abs(this.steer) <= d) this.steer = 0;
      else this.steer -= Math.sign(this.steer) * d;
    }
    this.steer = Math.max(-CAR.maxSteer, Math.min(CAR.maxSteer, this.steer));

    // Speed
    this.braking = false;
    const F = inp.up && !inp.down, B = inp.down && !inp.up;
    if (F) {
      if (this.v < -0.01) { this.v = Math.min(0, this.v + CAR.brake * dt); this.braking = true; }
      else this.v = Math.min(CAR.maxFwd, this.v + CAR.accel * dt);
    } else if (B) {
      if (this.v > 0.01) { this.v = Math.max(0, this.v - CAR.brake * dt); this.braking = true; }
      else this.v = Math.max(-CAR.maxRev, this.v - CAR.accel * dt);
    } else {
      const d = CAR.coast * dt;
      this.v = Math.abs(this.v) <= d ? 0 : this.v - Math.sign(this.v) * d;
    }
    if (this.v !== 0) this.lastDir = Math.sign(this.v);

    // Integrate + collide
    if (this.v !== 0) {
      const ds = this.v * dt;
      const next = advance(this.pose, ds, this.steer);
      const body = bodyRect(next);
      const hits = this.obstacles.filter((o) => rectsOverlap(body, o));
      if (hits.length) {
        const dir = Math.sign(this.v);
        const newCrash = this.blockedDir !== dir;
        if (newCrash) this.crashes++;
        for (const o of hits) {
          const [x, y] = contactPoint(body, o);
          const m = this.markers.find((mk) => Math.hypot(mk.x - x, mk.y - y) < 0.8);
          if (m) { m.life = 1; m.touching = true; }
          else this.markers.push({ x, y, life: 1, touching: true });
          if (o.type === 'car') this.addScar(o.idx, o, x, y, Math.abs(this.v));
          this.addPlayerScar(body, x, y, Math.abs(this.v));
          breakLights(body, x, y, this.brokenLights);
          if (o.type === 'car') {
            if (!this.brokenParked.has(o.idx)) this.brokenParked.set(o.idx, new Set());
            breakLights(o, x, y, this.brokenParked.get(o.idx));
          }
        }
        this.blockedDir = dir;
        this.distSinceBlock = 0;
        const impact = Math.abs(this.v);
        this.v = 0;
        this.hooks.onCrash?.(newCrash, impact);
      } else {
        this.pose = next;
        const md = Math.sign(ds);
        if (this.moveDir && md !== this.moveDir) this.reversals++;
        this.moveDir = md;
        if (this.blockedDir) {
          if (Math.sign(ds) !== this.blockedDir) this.blockedDir = 0;
          else if ((this.distSinceBlock += Math.abs(ds)) > 0.5) this.blockedDir = 0;
        }
        this.checkCurbs(Math.abs(this.v));
        this.trailAcc += Math.abs(ds);
        if (this.trailAcc >= TRAIL_STEP) {
          this.trailAcc = 0;
          this.trail.push(wheelPositions(this.pose));
          if (this.trail.length > TRAIL_MAX) this.trail.splice(0, this.trail.length - TRAIL_MAX);
        }
      }
    }

    this.checkTargets(dt);
  }

  /** Indices of the curb zones containing a point. */
  zonesAt([x, y]) {
    const out = [];
    this.curbZones.forEach((z, i) => { if (pointInRect(x, y, z)) out.push(i); });
    return out;
  }

  /**
   * A wheel thuds only when it climbs up: onto a curb stone from the road side, or onto an island.
   * Dropping back down is silent.
   */
  checkCurbs(speed) {
    const prev = this.wheelPrev || wheelPositions(this.pose);
    const cur = wheelPositions(this.pose);
    cur.forEach((w, wi) => {
      const now = this.zonesAt(w), before = this.wheelZones[wi];
      const climbed = now.some((zi) => {
        if (before.includes(zi)) return false;
        const z = this.curbZones[zi];
        if (z.type === 'island') return true;
        return (prev[wi][1] - z.y) * z.up < 0; // came from the road side of the curb
      });
      if (climbed) this.hooks.onCurb?.(speed, wi);
      this.wheelZones[wi] = now;
    });
    this.wheelPrev = cur;
  }

  /** Record a scar on a parked car, in that car's local frame, snapped to the nearest body edge. */
  addScar(index, o, x, y, speed) {
    const sc = makeScar(o, x, y, speed);
    if (this.scars.some((p) => p.index === index && Math.hypot(p.lx - sc.lx, p.ly - sc.ly) < 0.25)) return;
    this.scars.push({ index, ...sc });
  }

  /** Scratches on the player's own car, kept in its body frame so they move with it. */
  addPlayerScar(body, x, y, speed) {
    const sc = makeScar(body, x, y, speed);
    if (this.playerScars.some((p) => Math.hypot(p.lx - sc.lx, p.ly - sc.ly) < 0.25)) return;
    this.playerScars.push(sc);
  }

  updateMarkers(dt) {
    const body = bodyRect(this.pose);
    for (const m of this.markers) {
      m.touching = pointInRect(m.x, m.y, body, 0.15);
      if (!m.touching) m.life -= dt / 3; // fade over 3 s once separated
    }
    this.markers = this.markers.filter((m) => m.life > 0);
  }

  checkTargets(dt) {
    const body = bodyRect(this.pose);
    const cs = corners(body);
    let best = { index: -1, inside: false, ok: false, progress: 0 };
    this.targets.forEach((t, i) => {
      const spec = this.scenario.targets[i];
      const inside = cs.every(([x, y]) => pointInRect(x, y, t));
      if (!inside) return;
      const tol = (spec.tol * Math.PI) / 180;
      const headingOk = spec.headings.some((h) => Math.abs(wrapAngle(this.pose.theta - h)) <= tol);
      const stopped = spec.requireStop === false || Math.abs(this.v) < STOP_SPEED;
      const ok = headingOk && stopped;
      if (!best.inside || (ok && !best.ok)) best = { index: i, inside, ok, headingOk, stopped, progress: 0 };
    });
    const spec = best.index >= 0 ? this.scenario.targets[best.index] : null;
    const holdNeeded = spec && spec.requireStop === false ? 0 : HOLD_TIME;
    if (best.ok) this.hold += dt;
    else this.hold = 0;
    best.progress = holdNeeded ? Math.min(1, this.hold / holdNeeded) : 1;
    this.targetStatus = best;
    if (best.ok && this.hold >= holdNeeded) {
      this.state = 'success';
      this.v = 0;
      this.input.clear();
      this.hooks.onSuccess?.({ reversals: this.reversals, crashes: this.crashes });
    }
  }

  computeSensors() {
    const body = bodyRect(this.pose);
    const c = Math.cos(body.angle), s = Math.sin(body.angle);
    const near = this.obstacles.filter(
      (o) => o.type !== 'bound' && Math.hypot(o.x - body.x, o.y - body.y) < Math.hypot(o.hw, o.hh) + 5,
    );
    const zone = (rays) => {
      let best = Infinity;
      for (const [lx, ly, a] of rays) {
        const ox = body.x + lx * c - ly * s, oy = body.y + lx * s + ly * c;
        const dx = Math.cos(body.angle + a), dy = Math.sin(body.angle + a);
        for (const o of near) best = Math.min(best, rayRect(ox, oy, dx, dy, o, SENSOR_RANGE));
      }
      return best;
    };
    return { front: RAYS.front.map(zone), rear: RAYS.rear.map(zone) };
  }

  // ------------------------------------------------------------ rendering

  resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    return { W, H, dpr };
  }

  /** The camera follows the car's position and rotation: the car always points up the screen. */
  updateCamera(W, H, dt) {
    const body = bodyRect(this.pose);
    const target = {
      ppm: followZoom(W, H),
      cx: body.x, cy: body.y,
      rot: -body.angle - Math.PI / 2,
      ox: 0, oy: TOP_BAR / 2 + H * 0.12, // car sits below centre so more is visible ahead
    };
    if (!this.cam) { this.cam = target; return; }
    // Position locked to the car; rotation eased slightly so turning feels smooth.
    this.cam.ppm = target.ppm;
    this.cam.cx = target.cx;
    this.cam.cy = target.cy;
    this.cam.ox = target.ox;
    this.cam.oy = target.oy;
    this.cam.rot += wrapAngle(target.rot - this.cam.rot) * Math.min(1, dt * 8);
  }

  render(dt = 0) {
    const { W, H, dpr } = this.resize();
    const ctx = this.ctx;
    this.updateCamera(W, H, dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    applyCamera(ctx, this.cam, W, H, dpr);
    const sc = this.scenario;
    drawGround(ctx, sc);
    drawScenery(ctx, sc, 'ground');
    drawTargets(ctx, sc.targets, this.targetStatus, this.time);
    if (this.settings.trail) drawPaths(ctx, this.trail, '#1c1c1c', 0.85, 0.14);
    drawObstacles(ctx, sc, this.brokenParked);
    drawScars(ctx, sc, this.scars);

    if (this.state !== 'success') {
      const fwd = predictPath(this.pose, this.steer, PREDICT_DIST);
      const rev = predictPath(this.pose, this.steer, -PREDICT_DIST);
      const fActive = this.lastDir >= 0;
      drawPaths(ctx, fwd, '#4fc3f7', fActive ? 0.9 : 0.3, 0.14, [0, 1]); // front tyres only
      drawPaths(ctx, rev, '#ffb74d', fActive ? 0.3 : 0.9, 0.14, [0, 1]);
    }

    const body = bodyRect(this.pose);
    if (this.settings.sensors) drawSensorArcs(ctx, body, this.sensors);
    drawCar(ctx, {
      x: body.x, y: body.y, angle: body.angle,
      color: '#f4f5f7', steer: this.steer,
      brake: this.braking || (this.v === 0 && (this.input.up || this.input.down) && this.blockedDir !== 0),
      reverse: this.v < 0 || (this.v === 0 && this.lastDir < 0 && this.input.down),
      broken: this.brokenLights,
    });
    for (const ps of this.playerScars) drawScar(ctx, { x: body.x, y: body.y, angle: body.angle, w: CAR.length, h: CAR.width }, ps);
    drawScenery(ctx, sc, 'top'); // tree canopies above everything on the ground, including the player
    drawCrashMarkers(ctx, this.markers, this.time);
  }
}

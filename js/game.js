// Game state, fixed-timestep simulation and world rendering.
import { CAR, advance, bodyRect, centerToRear, predictPath, wheelPositions, wrapAngle } from './car.js';
import { contactPoint, corners, pointInRect, rayRect, rectsOverlap } from './collision.js';
import {
  applyCamera, clampCamera, drawCar, drawCrashMarkers, drawGround, drawObstacles, drawPaths, drawScars,
  drawScenery, drawSensorArcs, drawTargets, fitCamera, followZoom, SENSOR_RANGE,
} from './render.js';

const DT = 1 / 60;
const HOLD_TIME = 1.0;      // seconds to hold a valid pose before success
const STOP_SPEED = 0.05;
const TRAIL_STEP = 0.1;
const TRAIL_MAX = 8000;
const PREDICT_DIST = 1.5;
const TOP_BAR = 56;

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
    this.obstacles = [...scenario.obstacles, ...walls].map(toRect);
    this.targets = scenario.targets.map(toRect);
    this.reset();
  }

  get followCam() {
    return this.scenario?.largeMap ? this.settings.followLarge : this.settings.follow;
  }

  reset() {
    this.pose = centerToRear(this.scenario.start);
    this.steer = 0;
    this.v = 0;
    this.braking = false;
    this.lastDir = 1;
    this.crashes = 0;
    this.elapsed = 0;
    this.started = false;
    this.markers = [];
    this.scars = []; // permanent scratches on bumped parked cars (cleared on reset)
    this.blockedDir = 0;
    this.distSinceBlock = 0;
    this.trail = [wheelPositions(this.pose)];
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
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  pause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.input.clear();
      this.hooks.onPause?.(true);
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'playing';
      this.last = performance.now();
      this.hooks.onPause?.(false);
    }
  }

  togglePause() {
    if (this.state === 'paused') this.resume();
    else this.pause();
  }

  /** Tab/window in background: freeze simulation + timer silently (no pause overlay). */
  setBackground(bg) {
    if (bg === !!this.background) return;
    this.background = bg;
    this.input.clear();
    if (!bg) { this.last = performance.now(); this.acc = 0; }
  }

  markStarted() {
    if (this.state === 'playing') this.started = true;
  }

  loop(now) {
    if (!this.running) return;
    const frameDt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += frameDt;
    if (this.state === 'playing' && !this.background) {
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
    if (this.started) this.elapsed += dt;

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
          if (o.type === 'car') this.addScar(this.obstacles.indexOf(o), o, x, y, Math.abs(this.v));
        }
        this.blockedDir = dir;
        this.distSinceBlock = 0;
        const impact = Math.abs(this.v);
        this.v = 0;
        this.hooks.onCrash?.(newCrash, impact);
      } else {
        this.pose = next;
        if (this.blockedDir) {
          if (Math.sign(ds) !== this.blockedDir) this.blockedDir = 0;
          else if ((this.distSinceBlock += Math.abs(ds)) > 0.5) this.blockedDir = 0;
        }
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

  /** Record a scar on a parked car, in that car's local frame, snapped to the nearest body edge. */
  addScar(index, o, x, y, speed) {
    const c = Math.cos(o.angle), s = Math.sin(o.angle);
    const dx = x - o.x, dy = y - o.y;
    let lx = dx * c + dy * s, ly = -dx * s + dy * c;
    let along; // scratch direction in local frame
    if (o.hw - Math.abs(lx) < o.hh - Math.abs(ly)) {
      lx = Math.sign(lx || 1) * (o.hw - 0.18);
      ly = Math.max(-o.hh + 0.1, Math.min(o.hh - 0.1, ly));
      along = Math.PI / 2;
    } else {
      ly = Math.sign(ly || 1) * (o.hh - 0.16);
      lx = Math.max(-o.hw + 0.1, Math.min(o.hw - 0.1, lx));
      along = 0;
    }
    if (this.scars.some((sc) => sc.index === index && Math.hypot(sc.lx - lx, sc.ly - ly) < 0.25)) return;
    this.scars.push({
      index, lx, ly, along,
      size: Math.min(1.0, 0.55 + speed * 0.15),
      seed: Math.random() * 1000,
    });
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
      this.hooks.onSuccess?.({ time: this.elapsed, crashes: this.crashes });
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

  updateCamera(W, H, dt) {
    const b = this.scenario.bounds;
    if (!this.followCam) {
      this.cam = fitCamera(b, W, H, TOP_BAR, 0);
      this.cam.mode = 'static';
      return;
    }
    const body = bodyRect(this.pose);
    const ppm = followZoom(W, H);
    const look = this.v * 0.5;
    const target = clampCamera({
      ppm,
      cx: body.x + Math.cos(body.angle) * look,
      cy: body.y + Math.sin(body.angle) * look - TOP_BAR / 2 / ppm,
    }, b, W, H);
    if (!this.cam || this.cam.mode !== 'follow') {
      this.cam = { ...target, mode: 'follow' };
      return;
    }
    const k = Math.min(1, dt * 4);
    this.cam.ppm = ppm;
    this.cam.cx += (target.cx - this.cam.cx) * k;
    this.cam.cy += (target.cy - this.cam.cy) * k;
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
    drawObstacles(ctx, sc);
    drawScars(ctx, sc, this.scars);
    drawScenery(ctx, sc, 'top');

    if (this.settings.trajectory && this.state !== 'success') {
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
    });
    drawCrashMarkers(ctx, this.markers, this.time);
  }
}

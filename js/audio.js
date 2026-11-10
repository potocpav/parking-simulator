// Synthesised sounds (Web Audio API, no asset files): engine, parking-sensor beeps, bumps.
import { CAR } from './car.js';
import { sensorLevel } from './render.js';

const BEEP_FREQ = 2100;   // Hz
const BEEP_LEN = 0.07;    // s
// Beep period (s) per sensor step 1..3 (slow, medium, fast); step 4 is a continuous tone.
// Steps and distances come from sensorLevel() so the sound always matches the on-screen bars.
const PERIODS = [0, 0.6, 0.32, 0.15];

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.active = false;   // in a running, foreground game
    this.nextBeep = 0;
    // The browser only allows audio after a user gesture.
    const unlock = () => {
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // ---- engine: triangle + sub sine → low-pass, amplitude-modulated for a "firing" rumble
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 200;
    this.engFilter.Q.value = 0.7;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engAm = ctx.createGain();
    this.engAm.gain.value = 0.7;
    this.engFilter.connect(this.engAm).connect(this.engGain).connect(this.master);

    this.engOsc = ctx.createOscillator();
    this.engOsc.type = 'triangle';
    this.engSub = ctx.createOscillator();
    this.engSub.type = 'sine';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.8;
    this.engOsc.connect(this.engFilter);
    this.engSub.connect(subGain).connect(this.engFilter);

    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.2;
    this.lfo.connect(lfoDepth).connect(this.engAm.gain);

    this.setEngine(0, 0, true); // set idle values directly (oscillators default to 440 Hz)
    this.engOsc.start();
    this.engSub.start();
    this.lfo.start();

    // ---- sensor tone: a sine gated by a gain node
    this.beepGain = ctx.createGain();
    this.beepGain.gain.value = 0;
    this.beepOsc = ctx.createOscillator();
    this.beepOsc.type = 'sine';
    this.beepOsc.frequency.value = BEEP_FREQ;
    this.beepOsc.connect(this.beepGain).connect(this.master);
    this.beepOsc.start();

    // ---- noise buffer for bumps
    const len = Math.floor(ctx.sampleRate * 0.4);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);

    this.applyMaster();
  }

  applyMaster() {
    if (!this.ctx) return;
    const on = this.enabled && this.active;
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  setEnabled(v) { this.enabled = v; this.applyMaster(); }

  setActive(v) {
    if (this.active === v) return;
    this.active = v;
    this.applyMaster();
    if (!v && this.ctx) { this.silenceBeep(this.ctx.currentTime); this.nextBeep = 0; this.continuous = false; }
  }

  silenceBeep(t) {
    this.beepGain.gain.cancelScheduledValues(t);
    this.beepGain.gain.setTargetAtTime(0, t, 0.01);
  }

  /** speedFrac 0..1, throttle 0/1. */
  setEngine(speedFrac, throttle, immediate = false) {
    const t = this.ctx.currentTime;
    const rpm = 0.25 + speedFrac * 0.55 + throttle * 0.2; // 0.25 = idle
    const f = 22 + rpm * 45;
    const set = (param, v, tc) => {
      if (immediate) { param.cancelScheduledValues(t); param.setValueAtTime(v, t); }
      else param.setTargetAtTime(v, t, tc);
    };
    set(this.engOsc.frequency, f, 0.08);
    set(this.engSub.frequency, f / 2, 0.08);
    set(this.lfo.frequency, f / 2, 0.08);
    set(this.engFilter.frequency, 150 + rpm * 350 + throttle * 120, 0.1);
    set(this.engGain.gain, 0.0455 + rpm * 0.065 + throttle * 0.0325, 0.1);
  }


  /** Called every frame with the game. */
  update(game) {
    if (!this.ctx || !this.active || !this.enabled) return;
    const t = this.ctx.currentTime;
    const playing = game.state === 'playing';
    const inp = game.input;
    const throttle = playing && (inp.up || inp.down) && !game.braking ? 1 : 0;
    const max = game.v >= 0 ? CAR.maxFwd : CAR.maxRev;
    this.setEngine(Math.min(1, Math.abs(game.v) / max), throttle);

    // Parking sensors: the side you are driving towards (plus anything critically close).
    let d = Infinity;
    if (playing && game.settings.sensors && game.sensors) {
      const front = Math.min(...game.sensors.front), rear = Math.min(...game.sensors.rear);
      d = game.lastDir >= 0 ? front : rear;
      if (sensorLevel(Math.min(front, rear)) === 4) d = Math.min(front, rear);
    }
    const level = sensorLevel(d);
    if (level === 0) {
      this.silenceBeep(t);
      this.nextBeep = 0;
      this.continuous = false;
      return;
    }
    if (level === 4) {
      if (!this.continuous) { this.beepGain.gain.cancelScheduledValues(t); this.beepGain.gain.setTargetAtTime(0.16, t, 0.01); }
      this.continuous = true;
      this.nextBeep = 0;
      return;
    }
    if (this.continuous) {
      this.silenceBeep(t);
      this.continuous = false;
    }
    const interval = PERIODS[level];
    if (this.nextBeep === 0 || this.nextBeep < t - 0.2) this.nextBeep = t + 0.02;
    while (this.nextBeep < t + 0.1) {
      const s = this.nextBeep;
      const g = this.beepGain.gain;
      g.setValueAtTime(0, s);
      g.linearRampToValueAtTime(0.16, s + 0.005);
      g.setValueAtTime(0.16, s + BEEP_LEN);
      g.linearRampToValueAtTime(0, s + BEEP_LEN + 0.01);
      this.nextBeep = s + interval;
    }
  }

  /** Collision thud; `speed` in m/s at impact. */
  bump(speed) {
    if (!this.ctx || !this.active || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const vol = Math.min(0.7, 0.3 + speed / 6);

    // Soft low thud: gentle attack, no click.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(85, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.3);

    // Muffled bumper knock: low-passed noise, quiet.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 450 + speed * 120;
    lp.Q.value = 0.5;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    src.connect(lp).connect(ng).connect(this.master);
    src.start(t);
    src.stop(t + 0.16);
  }
}

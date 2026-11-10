// Boot, hash routing and DOM glue.
import { Game } from './game.js';
import { drawSensorWidget } from './hud.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { buildMenu, formatBest, formatTime, refreshMenu, renderThumbnails } from './menu.js';
import { SENSOR_RANGE } from './render.js';
import { getScenario, nextScenario, SCENARIOS } from './scenarios.js';
import * as storage from './storage.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  menuView: $('#menu-view'),
  gameView: $('#game-view'),
  track: $('#card-track'),
  summary: $('#progress-summary'),
  canvas: $('#world'),
  title: $('#scen-title'),
  timer: $('#stat-time'),
  crashes: $('#stat-crashes'),
  options: $('#options-panel'),
  select: $('#scenario-select'),
  hud: $('#hud'),
  gear: $('#hud-gear'),
  speed: $('#hud-speed'),
  sensorWrap: $('#sensor-wrap'),
  sensorCanvas: $('#hud-sensors'),
  sensorDist: $('#hud-sensor-dist'),
  touch: $('#touch-controls'),
  pauseOverlay: $('#overlay-pause'),
  successOverlay: $('#overlay-success'),
  toast: $('#toast'),
};

const settings = storage.loadSettings();
const coarse = matchMedia('(pointer: coarse)').matches;
if (settings.touch === null) settings.touch = coarse;
if (settings.follow === null) settings.follow = coarse;

const input = new Input();
const sound = new Sound();
sound.setEnabled(settings.sound);
input.bindTouch(els.touch);

let current = null;

const game = new Game(els.canvas, input, {
  onFrame: (g) => { updateHud(g); syncSound(); sound.update(g); },
  onPause: (p) => { els.pauseOverlay.hidden = !p; },
  onSuccess: showSuccess,
  onCrash: (isNew, impact) => {
    if (!isNew) return;
    sound.bump(impact);
    if (navigator.vibrate && settings.touch) navigator.vibrate(60);
  },
});

window.__game = game; // handy for debugging from the console
window.__sound = sound;
input.on('pause', () => {
  if (!els.successOverlay.hidden) return;
  game.togglePause();
});
input.on('reset', () => restart());
input.on('any', () => game.markStarted());

// ------------------------------------------------------------ menu

buildMenu(els.track, SCENARIOS);
$('#scroll-left').addEventListener('click', () => scrollCards(-1));
$('#scroll-right').addEventListener('click', () => scrollCards(1));
els.track.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    els.track.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}, { passive: false });

function scrollCards(dir) {
  const card = els.track.querySelector('.card');
  const step = card ? card.getBoundingClientRect().width + 16 : 300;
  els.track.scrollBy({ left: dir * step, behavior: 'smooth' });
}

for (const s of SCENARIOS) {
  const o = document.createElement('option');
  o.value = s.id;
  o.textContent = s.title;
  els.select.appendChild(o);
}
els.select.addEventListener('change', () => {
  els.select.blur();
  location.hash = `#/play/${els.select.value}`;
});

// ------------------------------------------------------------ options

const OPTION_KEYS = ['trajectory', 'sensors', 'trail', 'follow', 'touch', 'sound'];

function syncOptions() {
  for (const k of OPTION_KEYS) {
    const cb = document.getElementById(`opt-${k}`);
    cb.checked = k === 'follow' ? game.followCam : !!settings[k];
  }
  els.sensorWrap.hidden = !settings.sensors;
  els.touch.hidden = !settings.touch;
  els.gameView.classList.toggle('touch-on', !!settings.touch);
}

for (const k of OPTION_KEYS) {
  document.getElementById(`opt-${k}`).addEventListener('change', (e) => {
    const v = e.target.checked;
    if (k === 'follow') {
      if (current?.largeMap) settings.followLarge = v;
      else settings.follow = v;
    } else {
      settings[k] = v;
    }
    storage.saveSettings(settings);
    sound.setEnabled(settings.sound);
    syncOptions();
    e.target.blur();
  });
}

$('#btn-options').addEventListener('click', (e) => {
  e.stopPropagation();
  els.options.hidden = !els.options.hidden;
  e.currentTarget.blur();
});
document.addEventListener('pointerdown', (e) => {
  if (!els.options.hidden && !els.options.contains(e.target) && e.target.id !== 'btn-options') {
    els.options.hidden = true;
  }
});

// ------------------------------------------------------------ game buttons

const blurAfter = (fn) => (e) => { e.currentTarget.blur(); fn(); };
$('#btn-menu').addEventListener('click', blurAfter(() => { location.hash = '#/'; }));
$('#btn-reset').addEventListener('click', blurAfter(() => restart()));
$('#btn-pause').addEventListener('click', blurAfter(() => game.togglePause()));
$('#pause-resume').addEventListener('click', blurAfter(() => game.resume()));
$('#pause-reset').addEventListener('click', blurAfter(() => restart()));
$('#pause-menu').addEventListener('click', blurAfter(() => { location.hash = '#/'; }));
$('#success-restart').addEventListener('click', blurAfter(() => restart()));
$('#success-menu').addEventListener('click', blurAfter(() => { location.hash = '#/'; }));
$('#success-next').addEventListener('click', blurAfter(() => {
  const n = current && nextScenario(current.id);
  if (n) location.hash = `#/play/${n.id}`;
}));


// Sound plays only in a running, unpaused, foreground game.
function syncSound() {
  sound.setActive(!!current && game.state !== 'paused' && !game.background);
}

const syncBackground = () => { game.setBackground(document.hidden || !document.hasFocus()); syncSound(); };
document.addEventListener('visibilitychange', syncBackground);
window.addEventListener('blur', syncBackground);
window.addEventListener('focus', syncBackground);

function restart() {
  if (!current) return;
  els.successOverlay.hidden = true;
  els.pauseOverlay.hidden = true;
  game.reset();
}

// ------------------------------------------------------------ HUD

const hudCache = {};
function setText(el, key, text) {
  if (hudCache[key] !== text) { hudCache[key] = text; el.textContent = text; }
}

function updateHud(g) {
  setText(els.timer, 'time', formatTime(g.elapsed));
  setText(els.crashes, 'crashes', String(g.crashes));
  const gear = g.v > 0.01 ? 'D' : g.v < -0.01 ? 'R' : g.lastDir < 0 ? 'R' : 'D';
  setText(els.gear, 'gear', Math.abs(g.v) < 0.01 ? 'N' : gear);
  els.gear.dataset.gear = Math.abs(g.v) < 0.01 ? 'N' : gear;
  setText(els.speed, 'speed', `${(Math.abs(g.v) * 3.6).toFixed(0)} km/h`);
  if (settings.sensors) {
    drawSensorWidget(els.sensorCanvas, g.sensors);
    const d = Math.min(...g.sensors.front, ...g.sensors.rear);
    setText(els.sensorDist, 'sd', d < SENSOR_RANGE ? `${d.toFixed(2)} m` : '—');
  }
}

// ------------------------------------------------------------ success

function showSuccess(result) {
  const { best, isNewBest, previous } = storage.recordResult(current.id, result);
  $('#success-time').textContent = formatTime(result.time);
  $('#success-crashes').textContent = String(result.crashes);
  $('#success-best').textContent = formatBest(best);
  $('#success-newbest').hidden = !(isNewBest && previous);
  $('#success-first').hidden = !!previous;
  const n = nextScenario(current.id);
  const next = $('#success-next');
  next.disabled = !n;
  next.textContent = n ? 'Next scenario →' : 'All scenarios done';
  els.successOverlay.hidden = false;
  setTimeout(() => (n ? next : $('#success-restart')).focus({ preventScroll: true }), 50);
}

// ------------------------------------------------------------ routing

let toastTimer = 0;
function toast(text, ms = 4500) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  els.toast.classList.remove('fade');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('fade'), ms);
}

function showMenu() {
  current = null;
  sound.setActive(false);
  game.stop();
  input.enabled = false;
  input.clear();
  els.gameView.hidden = true;
  els.menuView.hidden = false;
  els.successOverlay.hidden = true;
  els.pauseOverlay.hidden = true;
  els.options.hidden = true;
  document.title = 'Parking Trainer';
  refreshMenu(els.track, SCENARIOS, storage.loadProgress(), els.summary);
  requestAnimationFrame(() => renderThumbnails(els.track, SCENARIOS));
}

function showGame(id) {
  const s = getScenario(id);
  current = s;
  els.menuView.hidden = true;
  els.gameView.hidden = false;
  els.successOverlay.hidden = true;
  els.pauseOverlay.hidden = true;
  els.options.hidden = true;
  els.title.textContent = s.title;
  els.select.value = s.id;
  document.title = `${s.title} · Parking Trainer`;
  input.enabled = true;
  game.load(s, settings);
  syncOptions();
  game.start();
  const keys = settings.touch ? '' : ' · Arrows: drive & steer · Esc: pause · R: restart';
  toast(`${s.description}${keys}`);
}

function route() {
  const m = location.hash.match(/^#\/play\/([\w-]+)/);
  if (m && getScenario(m[1])) {
    showGame(m[1]);
  } else {
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
    showMenu();
  }
}

window.addEventListener('hashchange', route);
let resizeTimer = 0;
window.addEventListener('resize', () => {
  if (!current) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderThumbnails(els.track, SCENARIOS), 150);
  }
});
route();

// Boot, hash routing and DOM glue.
//   #/                  scenario groups
//   #/group/<groupId>   the levels of one group
//   #/play/<scenarioId> a level
import { Game } from './game.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { buildGroupCards, buildLevelCards, formatBest, progressSummary, renderThumbnails } from './menu.js';
import { getGroup, getScenario, GROUPS, nextScenario, SCENARIOS } from './scenarios.js';
import * as storage from './storage.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  menuView: $('#menu-view'),
  gameView: $('#game-view'),
  track: $('#card-track'),
  summary: $('#progress-summary'),
  menuBack: $('#menu-back'),
  menuHeading: $('#menu-heading'),
  canvas: $('#world'),
  title: $('#scen-title'),
  rev: $('#stat-rev'),
  par: $('#stat-par'),
  starRev: $('#star-rev'),
  crashes: $('#stat-crashes'),
  starCrash: $('#star-crash'),
  options: $('#options-panel'),
  select: $('#scenario-select'),
  gear: $('#hud-gear'),
  speed: $('#hud-speed'),
  touch: $('#touch-controls'),
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
  onSuccess: showSuccess,
  onCrash: (isNew, impact) => {
    if (!isNew) return;
    sound.bump(impact);
    if (navigator.vibrate && settings.touch) navigator.vibrate(60);
  },
});

window.__game = game; // handy for debugging from the console
window.__sound = sound;
input.on('reset', () => restart());

// ------------------------------------------------------------ menu

$('#scroll-left').addEventListener('click', () => scrollCards(-1));
$('#scroll-right').addEventListener('click', () => scrollCards(1));
els.track.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && els.track.scrollWidth > els.track.clientWidth) {
    els.track.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}, { passive: false });

function scrollCards(dir) {
  const card = els.track.firstElementChild;
  const step = card ? card.getBoundingClientRect().width + 16 : 300;
  els.track.scrollBy({ left: dir * step, behavior: 'smooth' });
}

for (const g of GROUPS) {
  const og = document.createElement('optgroup');
  og.label = g.title;
  for (const id of g.levels) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = getScenario(id).title;
    og.appendChild(o);
  }
  els.select.appendChild(og);
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
  els.touch.hidden = !settings.touch;
  const sb = $('#btn-sound');
  sb.textContent = settings.sound ? '🔊' : '🔇';
  sb.classList.toggle('off', !settings.sound);
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

const groupHash = () => (current ? `#/group/${current.group}` : '#/');
const blurAfter = (fn) => (e) => { e.currentTarget.blur(); fn(); };
$('#btn-menu').addEventListener('click', blurAfter(() => { location.hash = groupHash(); }));
$('#btn-reset').addEventListener('click', blurAfter(() => restart()));
$('#btn-sound').addEventListener('click', blurAfter(() => {
  settings.sound = !settings.sound;
  storage.saveSettings(settings);
  sound.setEnabled(settings.sound);
  syncOptions();
}));
// Full screen (hidden where the Fullscreen API is unavailable, e.g. iPhone Safari).
const fsBtn = $('#btn-fullscreen');
const root = document.documentElement;
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
if (document.fullscreenEnabled || document.webkitFullscreenEnabled) {
  fsBtn.hidden = false;
  fsBtn.addEventListener('click', blurAfter(() => {
    if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
  }));
  const syncFs = () => {
    const on = !!fsElement();
    fsBtn.classList.toggle('is-fs', on);
    fsBtn.title = on ? 'Exit full screen' : 'Full screen';
    fsBtn.setAttribute('aria-label', fsBtn.title);
  };
  document.addEventListener('fullscreenchange', syncFs);
  document.addEventListener('webkitfullscreenchange', syncFs);
}

$('#success-restart').addEventListener('click', blurAfter(() => restart()));
$('#success-menu').addEventListener('click', blurAfter(() => { location.hash = groupHash(); }));
$('#success-next').addEventListener('click', blurAfter(() => {
  const n = current && nextScenario(current.id);
  if (n) location.hash = `#/play/${n.id}`;
}));

// Sound plays only in a running game while the page is in the foreground.
function syncSound() {
  sound.setActive(!!current && !document.hidden && document.hasFocus());
}
document.addEventListener('visibilitychange', syncSound);
window.addEventListener('blur', syncSound);
window.addEventListener('focus', syncSound);

function restart() {
  if (!current) return;
  els.successOverlay.hidden = true;
  game.reset();
}

// ------------------------------------------------------------ HUD

const hudCache = {};
function setText(el, key, text) {
  if (hudCache[key] !== text) { hudCache[key] = text; el.textContent = text; }
}

function updateHud(g) {
  setText(els.rev, 'rev', String(g.reversals));
  setText(els.par, 'par', `/${current.par}`);
  els.starRev.hidden = g.reversals > current.par;
  setText(els.crashes, 'crashes', String(g.crashes));
  els.starCrash.hidden = g.crashes > 0;
  const gear = g.v > 0.01 ? 'D' : g.v < -0.01 ? 'R' : g.lastDir < 0 ? 'R' : 'D';
  setText(els.gear, 'gear', Math.abs(g.v) < 0.01 ? 'N' : gear);
  els.gear.dataset.gear = Math.abs(g.v) < 0.01 ? 'N' : gear;
  setText(els.speed, 'speed', `${(Math.abs(g.v) * 3.6).toFixed(0)} km/h`);
}

// ------------------------------------------------------------ success

function showSuccess(result) {
  const { best, isNewBest, previous } = storage.recordResult(current.id, result);
  const revStar = result.reversals <= current.par, crashStar = result.crashes === 0;
  const perfect = revStar && crashStar;
  $('#success-icon').textContent = perfect ? '★' : '✓';
  $('#success-icon').classList.toggle('star', perfect);
  $('#success-title').textContent = perfect ? 'Perfect!' : 'Parked!';
  $('#success-rev').textContent = `${result.reversals}${revStar ? ' ★' : ''}`;
  $('#success-par').textContent = `★ at ${current.par} or fewer`;
  $('#success-crashes').textContent = `${result.crashes}${crashStar ? ' ★' : ''}`;
  $('#success-best').textContent = formatBest(best, current.par);
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

function showMenu(group = null) {
  current = null;
  sound.setActive(false);
  game.stop();
  input.enabled = false;
  input.clear();
  els.gameView.hidden = true;
  els.menuView.hidden = false;
  els.successOverlay.hidden = true;
  els.options.hidden = true;
  const progress = storage.loadProgress();
  if (group) {
    buildLevelCards(els.track, group, SCENARIOS, progress);
    els.menuHeading.textContent = group.title;
    document.title = `${group.title} · Parking Trainer`;
  } else {
    buildGroupCards(els.track, GROUPS, SCENARIOS, progress);
    els.menuHeading.textContent = 'Scenarios';
    document.title = 'Parking Trainer';
  }
  els.menuBack.hidden = !group;
  els.menuView.classList.toggle('in-group', !!group);
  els.summary.textContent = progressSummary(SCENARIOS, progress);
  els.track.scrollLeft = 0;
  requestAnimationFrame(() => renderThumbnails(els.track, SCENARIOS));
}

function showGame(id) {
  const s = getScenario(id);
  current = s;
  els.menuView.hidden = true;
  els.gameView.hidden = false;
  els.successOverlay.hidden = true;
  els.options.hidden = true;
  els.title.textContent = s.title;
  els.select.value = s.id;
  document.title = `${s.title} · Parking Trainer`;
  input.enabled = true;
  game.load(s, settings);
  syncOptions();
  game.start();
  const keys = settings.touch ? '' : ' · Arrows: drive & steer · R: restart';
  const revs = s.par === 0 ? 'no reversals' : `at most ${s.par} reversal${s.par === 1 ? '' : 's'}`;
  toast(`${s.description} ★: no crashes, ${revs}.${keys}`);
}

function route() {
  const play = location.hash.match(/^#\/play\/([\w-]+)/);
  const grp = location.hash.match(/^#\/group\/([\w-]+)/);
  if (play && getScenario(play[1])) {
    showGame(play[1]);
  } else if (grp && getGroup(grp[1])) {
    showMenu(getGroup(grp[1]));
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

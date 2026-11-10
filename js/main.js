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
  resume: $('#resume-btn'),
  groupOverlay: $('#group-overlay'),
  levelGrid: $('#level-grid'),
  canvas: $('#world'),
  title: $('#scen-title'),
  rev: $('#stat-rev'),
  par: $('#stat-par'),
  starRev: $('#star-rev'),
  crashes: $('#stat-crashes'),
  starCrash: $('#star-crash'),
  options: $('#options-panel'),
  fps: $('#hud-fps'),
  touch: $('#touch-controls'),
  successOverlay: $('#overlay-success'),
  toast: $('#toast'),
};

const settings = storage.loadSettings();
const coarse = matchMedia('(pointer: coarse)').matches;
if (settings.touch === null) settings.touch = coarse;
if (settings.hiRes === null) settings.hiRes = !coarse; // phones default to the faster resolution

const input = new Input();
const sound = new Sound();
sound.setEnabled(settings.sound);
input.bindTouch(els.touch);

let current = null;
let resumeId = null; // level left unfinished; its game state is kept so it can be resumed

const game = new Game(els.canvas, input, {
  onFrame: (g) => { updateHud(g); syncSound(); sound.update(g); },
  onSuccess: showSuccess,
  onCurb: (speed) => sound.curb(speed),
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

els.groupOverlay.addEventListener('click', (e) => {
  if (e.target === els.groupOverlay) nav('#/');
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.groupOverlay.hidden && !els.menuView.hidden) nav('#/');
});

// ------------------------------------------------------------ options


const OPTION_KEYS = ['sensors', 'trail', 'hiRes', 'cacheScene', 'touch', 'sound'];

function syncOptions() {
  for (const k of OPTION_KEYS) {
    const cb = document.getElementById(`opt-${k}`);
    cb.checked = !!settings[k];
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
    settings[k] = v;
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
$('#btn-menu').addEventListener('click', blurAfter(() => nav(groupHash())));
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
$('#success-menu').addEventListener('click', blurAfter(() => nav(groupHash())));
$('#success-next').addEventListener('click', blurAfter(() => {
  const n = current && nextScenario(current.id);
  if (n) nav(`#/play/${n.id}`);
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
  setText(els.fps, 'fps', g.fps ? String(g.fps) : '–');
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
  $('#success-par').textContent = `Par: ${current.par}`;
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
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() {
  clearTimeout(toastTimer);
  els.toast.classList.add('fade');
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 800); // after the fade-out
}
els.toast.addEventListener('pointerdown', (e) => { e.stopPropagation(); hideToast(); });

function showMenu(group = null) {
  if (current) resumeId = game.state === 'playing' ? current.id : null;
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
  const wasMenu = !els.menuView.hidden && els.track.childElementCount > 0;
  const keepScroll = els.track.scrollLeft;
  buildGroupCards(els.track, GROUPS, SCENARIOS, progress);
  if (wasMenu) els.track.scrollLeft = keepScroll;
  if (group) {
    buildLevelCards(els.levelGrid, group, SCENARIOS, progress);
    $('#group-title').textContent = group.title;
    $('#group-desc').textContent = group.description;
    const dots = els.track.querySelector(`.stack[data-group="${group.id}"] .progress-dots`);
    $('#group-progress').innerHTML = dots ? dots.innerHTML : '';
    document.title = `${group.title} · Parking Trainer`;
  } else {
    document.title = 'Parking Trainer';
  }
  els.groupOverlay.hidden = !group;
  document.body.classList.toggle('modal-open', !!group);
  const rs = resumeId && getScenario(resumeId);
  els.resume.hidden = !rs;
  if (rs) {
    els.resume.href = `#/play/${rs.id}`;
    $('#resume-title').textContent = rs.title;
  }
  els.summary.textContent = progressSummary(SCENARIOS, progress);
  if (!wasMenu && group) {
    // Arriving from a game or a link: bring the group's stack into view behind the pop-up.
    const stack = els.track.querySelector(`.stack[data-group="${group.id}"]`);
    if (stack) els.track.scrollLeft = stack.offsetLeft - els.track.offsetLeft - 8;
  }
  requestAnimationFrame(() => {
    renderThumbnails(els.track, SCENARIOS);
    if (group) {
      renderThumbnails(els.levelGrid, SCENARIOS);
      els.levelGrid.scrollTop = 0;
    }
  });
}

function showGame(id) {
  const s = getScenario(id);
  current = s;
  els.menuView.hidden = true;
  els.gameView.hidden = false;
  els.successOverlay.hidden = true;
  els.options.hidden = true;
  els.groupOverlay.hidden = true;
  document.body.classList.remove('modal-open');
  els.title.textContent = s.title;
  document.title = `${s.title} · Parking Trainer`;
  input.enabled = true;
  const resuming = resumeId === id && game.scenario === s && game.state === 'playing';
  resumeId = null;
  if (!resuming) game.load(s, settings);
  syncOptions();
  game.start();
  if (resuming) return;
  const keys = settings.touch ? '' : ' · Arrows: drive & steer · R: restart';
  toast(`${s.description} Par: ${s.par} reversal${s.par === 1 ? '' : 's'}, no crashes.${keys}`);
}

// ------------------------------------------------------------ history
//
// The browser history always mirrors the hierarchy: main menu → group → level. Every entry stores
// its chain of ancestors; navigating goes back to the deepest entry shared with the target and
// pushes only what is missing, so the Back button always moves one level "up" and then leaves.

/** Hashes from the main menu down to `hash`, e.g. ['#/', '#/group/parallel', '#/play/parallel-easy']. */
function chainFor(hash) {
  const p = hash.match(/^#\/play\/([\w-]+)/), g = hash.match(/^#\/group\/([\w-]+)/);
  if (p && getScenario(p[1])) return ['#/', `#/group/${getScenario(p[1]).group}`, `#/play/${p[1]}`];
  if (g && getGroup(g[1])) return ['#/', `#/group/${g[1]}`];
  return ['#/'];
}

/** Write history entries for target[from..]; the first one replaces the current entry if asked. */
function writeEntries(target, from, replaceFirst) {
  for (let i = from; i < target.length; i++) {
    const state = { chain: target.slice(0, i + 1) };
    if (i === from && replaceFirst) history.replaceState(state, '', target[i]);
    else history.pushState(state, '', target[i]);
  }
}

let pending = null; // entries to write once an asynchronous history.go() has landed

function nav(hash) {
  const target = chainFor(hash);
  const cur = history.state?.chain || chainFor(location.hash);
  let k = 0;
  while (k < cur.length && k < target.length && cur[k] === target[k]) k++;
  const back = cur.length - k;
  if (back === 0) {                      // going deeper: push
    writeEntries(target, k, false);
    route();
  } else if (k === target.length) {      // going up: just go back
    history.go(-back);                   // → popstate → route()
  } else if (back === 1) {               // sideways at the same depth: replace
    writeEntries(target, k, true);
    route();
  } else {                               // up and then down another branch
    pending = { target, k };
    history.go(-(back - 1));
  }
}

window.addEventListener('popstate', () => {
  if (pending) {
    writeEntries(pending.target, pending.k, true);
    pending = null;
  } else if (!history.state?.chain) {
    // A hash typed into the address bar: give the new entry its chain.
    history.replaceState({ chain: chainFor(location.hash) }, '', location.hash || '#/');
  }
  route();
});

// In-app links (cards, back arrows, resume button) navigate through nav(); a modified click
// (new tab / window) is left to the browser.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  nav(a.getAttribute('href'));
});

function route() {
  const play = location.hash.match(/^#\/play\/([\w-]+)/);
  const grp = location.hash.match(/^#\/group\/([\w-]+)/);
  if (play && getScenario(play[1])) {
    showGame(play[1]);
  } else if (grp && getGroup(grp[1])) {
    showMenu(getGroup(grp[1]));
  } else {
    if (location.hash !== '#/') history.replaceState({ chain: ['#/'] }, '', '#/');
    showMenu();
  }
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  if (!current) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderThumbnails(els.track, SCENARIOS);
      if (!els.groupOverlay.hidden) renderThumbnails(els.levelGrid, SCENARIOS);
    }, 150);
  }
});

// On first load (including a shared deep link) lay down the full chain, so Back from a level goes
// to its group, then the main menu, then out of the site. A reload keeps the existing entries.
{
  const target = chainFor(location.hash);
  const st = history.state?.chain;
  if (!st || st.join() !== target.join()) writeEntries(target, 0, true);
}
route();

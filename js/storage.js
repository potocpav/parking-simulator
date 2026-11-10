// localStorage persistence (all access wrapped – storage may be unavailable).

const PREFIX = 'parksim.v1.';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* ignore */ }
}

/**
 * { [scenarioId]: { reversals, crashes } } – presence means completed.
 * Records from the old time-based version have no `reversals`; they still count as completed.
 */
export function loadProgress() {
  const p = read('progress', {});
  if (!p || typeof p !== 'object') return {};
  for (const r of Object.values(p)) if (r && typeof r.reversals !== 'number') r.reversals = null;
  return p;
}

/** Fewer crashes first, then fewer reversals. */
export function isBetter(a, b) {
  if (!b) return true;
  if (a.crashes !== b.crashes) return a.crashes < b.crashes;
  return b.reversals === null || a.reversals < b.reversals;
}

/** Perfect = no crashes and no more reversals than the scenario's par. */
export function isPerfect(rec, par) {
  return !!rec && rec.crashes === 0 && rec.reversals !== null && rec.reversals <= par;
}

/** Store a finished run; returns { best, isNewBest, previous }. */
export function recordResult(id, result) {
  const progress = loadProgress();
  const previous = progress[id] || null;
  const isNewBest = isBetter(result, previous);
  if (isNewBest) {
    progress[id] = { reversals: result.reversals, crashes: result.crashes };
    write('progress', progress);
  }
  return { best: progress[id], isNewBest, previous };
}

const DEFAULT_SETTINGS = {
  sensors: true,
  trail: true,
  touch: null,        // null = auto-detect
  hiRes: null,        // full pixel density; null = auto (off on touch devices)
  cacheScene: true,   // draw static scenery from a pre-rendered bitmap (test: compare FPS)
  sound: true,
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read('settings', {}) };
}

export function saveSettings(s) {
  write('settings', s);
}

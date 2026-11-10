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

/** { [scenarioId]: { time: seconds, crashes: n } } – presence means completed. */
export function loadProgress() {
  const p = read('progress', {});
  return p && typeof p === 'object' ? p : {};
}

export function isBetter(a, b) {
  if (!b) return true;
  return a.crashes < b.crashes || (a.crashes === b.crashes && a.time < b.time);
}

/** Store a finished run; returns { best, isNewBest, previous }. */
export function recordResult(id, result) {
  const progress = loadProgress();
  const previous = progress[id] || null;
  const isNewBest = isBetter(result, previous);
  if (isNewBest) {
    progress[id] = { time: Math.round(result.time * 10) / 10, crashes: result.crashes };
    write('progress', progress);
  }
  return { best: progress[id], isNewBest, previous };
}

const DEFAULT_SETTINGS = {
  trajectory: true,
  sensors: true,
  trail: true,
  follow: null,       // small maps (null = auto: on for touch devices)
  followLarge: true,  // large car-park maps
  touch: null,        // null = auto-detect
  sound: true,
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read('settings', {}) };
}

export function saveSettings(s) {
  write('settings', s);
}

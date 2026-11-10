// Main menu: stacked group cards (#/) that expand into level cards (#/group/<id>).
import { bodyRect, centerToRear } from './car.js';
import { renderPreview } from './render.js';
import { isPerfect } from './storage.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** '✓', '★' or '' for a scenario's stored best result. */
export function statusOf(scenario, progress) {
  const best = progress[scenario.id];
  if (!best) return '';
  return isPerfect(best, scenario.par) ? '★' : '✓';
}

export function formatBest(best, par) {
  if (!best) return '';
  const rev = best.reversals === null ? '' : `${plural(best.reversals, 'reversal')}${best.reversals <= par ? ' ★' : ''} · `;
  const crashes = `${best.crashes} ${best.crashes === 1 ? 'crash' : 'crashes'}`;
  return `Best: ${rev}${crashes}${best.crashes === 0 ? ' ★' : ''}`;
}

function thumb(scenarioId) {
  return `<div class="thumb"><canvas data-scenario="${scenarioId}"></canvas><span class="badge" hidden></span></div>`;
}

/** Top level: one stacked card per group. */
export function buildGroupCards(track, groups, scenarios, progress) {
  track.innerHTML = '';
  for (const g of groups) {
    const levels = g.levels.map((id) => scenarios.find((s) => s.id === id));
    const a = document.createElement('a');
    a.className = `stack layers-${Math.min(3, levels.length)}`;
    a.href = `#/group/${g.id}`;
    a.dataset.group = g.id;
    a.innerHTML = `
      <div class="card">
        ${thumb(levels[0].id)}
        <div class="card-body">
          <div class="card-head"><h3></h3><span class="levels-count"></span></div>
          <p></p>
          <div class="progress-dots"></div>
        </div>
      </div>`;
    a.querySelector('h3').textContent = g.title;
    a.querySelector('p').textContent = g.description;
    a.querySelector('.levels-count').textContent = plural(levels.length, 'level');
    const dots = a.querySelector('.progress-dots');
    for (const s of levels) {
      const st = statusOf(s, progress);
      const d = document.createElement('span');
      d.className = `dot ${st === '★' ? 'star' : st === '✓' ? 'done' : ''}`;
      d.textContent = st;
      d.title = `${s.title} (${s.difficulty})${st === '★' ? ': perfect' : st ? ': completed' : ''}`;
      dots.appendChild(d);
    }
    track.appendChild(a);
  }
}

/** Expanded group: one card per level. */
export function buildLevelCards(track, group, scenarios, progress) {
  track.innerHTML = '';
  for (const id of group.levels) {
    const s = scenarios.find((x) => x.id === id);
    const best = progress[s.id];
    const st = statusOf(s, progress);
    const a = document.createElement('a');
    a.className = `card level${st === '★' ? ' perfect' : st ? ' done' : ''}`;
    a.href = `#/play/${s.id}`;
    a.dataset.id = s.id;
    a.innerHTML = `
      ${thumb(s.id)}
      <div class="card-body">
        <div class="card-head"><h3></h3><span class="diff"></span></div>
        <p></p>
        <div class="par"></div>
        <div class="best"></div>
      </div>`;
    a.querySelector('h3').textContent = s.title;
    a.querySelector('p').textContent = s.description;
    const d = a.querySelector('.diff');
    d.textContent = s.difficulty;
    d.dataset.level = s.difficulty.toLowerCase();
    a.querySelector('.par').textContent = `Par: ${plural(s.par, 'reversal')}`;
    a.querySelector('.best').textContent = best ? formatBest(best, s.par) : 'Not completed yet';
    const badge = a.querySelector('.badge');
    badge.hidden = !st;
    badge.textContent = st;
    badge.classList.toggle('star', st === '★');
    track.appendChild(a);
  }
}

export function renderThumbnails(track, scenarios) {
  for (const canvas of track.querySelectorAll('canvas[data-scenario]')) {
    const s = scenarios.find((x) => x.id === canvas.dataset.scenario);
    if (!s) continue;
    const b = bodyRect(centerToRear(s.start));
    renderPreview(canvas, s, { x: b.x, y: b.y, angle: b.angle });
  }
}

export function progressSummary(scenarios, progress) {
  const done = scenarios.filter((s) => progress[s.id]).length;
  const stars = scenarios.filter((s) => isPerfect(progress[s.id], s.par)).length;
  // Sum of crashes in the best run of each completed level.
  const crashes = scenarios.reduce((n, s) => n + (progress[s.id]?.crashes || 0), 0);
  return `${done} / ${scenarios.length} completed · ${stars} ★ · ${crashes} ${crashes === 1 ? 'crash' : 'crashes'}`;
}

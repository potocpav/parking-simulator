// Main menu: horizontally scrollable scenario cards with rendered previews.
import { bodyRect, centerToRear } from './car.js';
import { renderPreview } from './render.js';

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function formatBest(best) {
  if (!best) return '';
  return `Best ${formatTime(best.time)} · ${best.crashes} ${best.crashes === 1 ? 'crash' : 'crashes'}`;
}

export function buildMenu(track, scenarios) {
  track.innerHTML = '';
  for (const s of scenarios) {
    const a = document.createElement('a');
    a.className = 'card';
    a.href = `#/play/${s.id}`;
    a.dataset.id = s.id;
    a.innerHTML = `
      <div class="thumb"><canvas></canvas><span class="badge" hidden>✓</span></div>
      <div class="card-body">
        <div class="card-head"><h3></h3><span class="diff"></span></div>
        <p></p>
        <div class="best"></div>
      </div>`;
    a.querySelector('h3').textContent = s.title;
    a.querySelector('p').textContent = s.description;
    const d = a.querySelector('.diff');
    d.textContent = s.difficulty;
    d.dataset.level = s.difficulty.toLowerCase();
    track.appendChild(a);
  }
}

export function renderThumbnails(track, scenarios) {
  for (const s of scenarios) {
    const canvas = track.querySelector(`.card[data-id="${s.id}"] canvas`);
    if (!canvas) continue;
    const b = bodyRect(centerToRear(s.start));
    renderPreview(canvas, s, { x: b.x, y: b.y, angle: b.angle });
  }
}

export function refreshMenu(track, scenarios, progress, summaryEl) {
  let done = 0;
  for (const s of scenarios) {
    const card = track.querySelector(`.card[data-id="${s.id}"]`);
    if (!card) continue;
    const best = progress[s.id];
    if (best) done++;
    card.classList.toggle('done', !!best);
    card.querySelector('.badge').hidden = !best;
    card.querySelector('.best').textContent = best ? formatBest(best) : 'Not completed yet';
  }
  if (summaryEl) summaryEl.textContent = `${done} / ${scenarios.length} completed`;
}

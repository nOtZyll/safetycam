import { classInfo } from './labels.js';

// Box colors mirror the CSS tokens: hi-vis = PPE worn, red = PPE missing.
const COLORS = {
  ppe: { stroke: '#B6F23A', fill: '#B6F23A', text: '#0B0B0C' },
  violation: { stroke: '#FF3340', fill: '#D91C27', text: '#FFFFFF' },
  person: { stroke: '#F3F3F1', fill: '#F3F3F1', text: '#0B0B0C' },
  other: { stroke: '#8D8D94', fill: '#8D8D94', text: '#0B0B0C' },
};

// Worker box colors by compliance status; orange = required gear not visible.
const WORKER_COLORS = {
  VIOLATION: COLORS.violation,
  UNCLEAR: { stroke: '#FF5A1F', fill: '#FF5A1F', text: '#0B0B0C' },
  SAFE: COLORS.ppe,
};
const WORKER_LABEL = { VIOLATION: 'Melanggar', UNCLEAR: 'Tidak jelas', SAFE: 'Aman' };

function setup(ctx) {
  const { width: W, height: H } = ctx.canvas;
  const unit = Math.max(1, Math.min(W, H) / 400);
  const fontSize = Math.round(Math.max(11, 12 * unit));
  ctx.lineWidth = Math.max(2, 2 * unit);
  ctx.font = `600 ${fontSize}px "Barlow", system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  return { W, H, unit, fontSize };
}

function drawTag(ctx, text, x1, y1, c, { W, unit, fontSize }) {
  const padX = 5 * unit;
  const tagH = fontSize + 6 * unit;
  const tagW = ctx.measureText(text).width + padX * 2;
  const tagY = y1 - tagH >= 0 ? y1 - tagH : y1;
  const tagX = Math.min(Math.max(0, x1 - ctx.lineWidth / 2), W - tagW);
  ctx.fillStyle = c.fill;
  ctx.fillRect(tagX, tagY, tagW, tagH);
  ctx.fillStyle = c.text;
  ctx.fillText(text, tagX + padX, tagY + 3 * unit);
}

/** Draw each worker's box in its status color, tagged "#1 Melanggar" etc. (tracker id when present). */
export function drawWorkers(ctx, workers) {
  const g = setup(ctx);
  workers.forEach((w, i) => {
    const c = WORKER_COLORS[w.status];
    const [x1, y1, x2, y2] = w.box;
    ctx.lineWidth = Math.max(3, 3 * g.unit);
    ctx.strokeStyle = c.stroke;
    ctx.setLineDash([8 * g.unit, 4 * g.unit]);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.setLineDash([]);
    drawTag(ctx, `#${w.id ?? i + 1} ${WORKER_LABEL[w.status]}`, x1, y1, c, g);
  });
}

/** Draw detections on a canvas whose pixel size equals the source image size. */
export function drawDetections(ctx, detections, { showPerson = true } = {}) {
  const g = setup(ctx);

  // Person boxes first so gear boxes sit on top.
  const isPerson = (d) => classInfo(d.name).kind === 'person';
  const ordered = [...detections.filter(isPerson), ...detections.filter((d) => !isPerson(d))];

  for (const d of ordered) {
    const info = classInfo(d.name);
    if (info.kind === 'person' && !showPerson) continue;
    const c = COLORS[info.kind] ?? COLORS.other;
    const [x1, y1, x2, y2] = d.box;

    ctx.lineWidth = Math.max(2, 2 * g.unit);
    ctx.strokeStyle = c.stroke;
    ctx.setLineDash(info.kind === 'person' ? [6 * g.unit, 4 * g.unit] : []);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.setLineDash([]);
    drawTag(ctx, `${info.label} ${Math.round(d.score * 100)}%`, x1, y1, c, g);
  }
}

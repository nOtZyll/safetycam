import { iou } from './postprocess.js';

/**
 * Keeps worker identities across webcam frames and smooths their status, so numbers stay put
 * and a single noisy frame does not flip a verdict.
 *
 * Matching: greedy by IoU between each track's last box and this frame's workers.
 * Smoothing: an item counts as missing when it was missing in at least `ratio` of the last
 * `window` frames, counted over at least `minHits` frames, so a brand-new track needs a couple
 * of frames before it can be flagged.
 */
export class WorkerTracker {
  constructor({ iouThreshold = 0.3, maxMissed = 15, window = 8, minHits = 3, ratio = 0.6 } = {}) {
    Object.assign(this, { iouThreshold, maxMissed, window, minHits, ratio });
    this.reset();
  }

  reset() {
    this.tracks = [];
    this.nextId = 1;
  }

  /**
   * workers: output of assessWorkers() for one frame.
   * Returns { workers, events }: workers carry a stable `id` and smoothed missing / unseen / status;
   * events lists items that just became missing on a track ({ id, items, box }), once per track and item.
   */
  update(workers) {
    const pairs = [];
    this.tracks.forEach((t, ti) => workers.forEach((w, wi) => {
      const v = iou(t.box, w.box);
      if (v >= this.iouThreshold) pairs.push([v, ti, wi]);
    }));
    pairs.sort((a, b) => b[0] - a[0]);

    const trackFor = new Map();
    const usedTracks = new Set();
    for (const [, ti, wi] of pairs) {
      if (usedTracks.has(ti) || trackFor.has(wi)) continue;
      usedTracks.add(ti);
      trackFor.set(wi, this.tracks[ti]);
    }

    this.tracks.forEach((t, ti) => { if (!usedTracks.has(ti)) t.missed++; });
    this.tracks = this.tracks.filter((t) => t.missed <= this.maxMissed);

    const events = [];
    const out = workers.map((w, wi) => {
      let t = trackFor.get(wi);
      if (!t) {
        t = { id: this.nextId++, history: [], logged: new Set() };
        this.tracks.push(t);
      }
      t.box = w.box;
      t.missed = 0;
      // notWorn = missing or unseen, so an item drifting from "unclear" to "missing" never shows as safe
      t.history.push({ missing: w.missing, notWorn: [...w.missing, ...w.unseen] });
      if (t.history.length > this.window) t.history.shift();

      const missing = this.#steady(t.history, 'missing');
      const unseen = this.#steady(t.history, 'notWorn').filter((i) => !missing.includes(i));
      const fresh = missing.filter((i) => !t.logged.has(i));
      if (fresh.length) {
        fresh.forEach((i) => t.logged.add(i));
        events.push({ id: t.id, items: fresh, box: w.box });
      }
      const status = missing.length ? 'VIOLATION' : unseen.length ? 'UNCLEAR' : 'SAFE';
      return { ...w, id: t.id, missing, unseen, status };
    });
    return { workers: out, events };
  }

  #steady(history, key) {
    const counts = {};
    for (const h of history) for (const item of h[key]) counts[item] = (counts[item] ?? 0) + 1;
    const need = this.ratio * Math.max(history.length, this.minHits);
    return Object.keys(counts).filter((item) => counts[item] >= need);
  }
}

const csvCell = (v) => (/[",\n;]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** Violation log entries ({ time: Date, id, items: [label] }) as CSV text. */
export function logToCSV(entries) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const rows = [['waktu', 'pekerja', 'pelanggaran'], ...entries.map((e) => [stamp(e.time), `#${e.id}`, e.items.join(', ')])];
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\n')}\n`;
}

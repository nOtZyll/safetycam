import { classInfo } from './labels.js';
import { classThresholds } from './postprocess.js';

// Port of training/compliance.py plus the per-worker rules picked in the notebook (section 9b).
export const PPE_ITEMS = ['helmet', 'vest', 'gloves', 'boots', 'goggles'];
// missing-PPE class -> item it negates. The dataset has no no_vest; "none" boxes sit on the torso.
export const MISSING = { no_helmet: 'helmet', no_gloves: 'gloves', no_boots: 'boots', no_goggle: 'goggles', none: 'vest' };
export const DEFAULT_REQUIRED = ['helmet', 'vest'];

const MISSING_OF = Object.fromEntries(Object.entries(MISSING).map(([cls, item]) => [item, cls]));
const itemLabel = (item) => classInfo(item).label.toLowerCase();
/** "helmet" -> "Tanpa helm". */
export const missingLabel = (item) => classInfo(MISSING_OF[item]).label;

/** Fraction of `inner` box area that lies inside `outer`. */
function overlap(inner, outer) {
  const x1 = Math.max(inner[0], outer[0]);
  const y1 = Math.max(inner[1], outer[1]);
  const x2 = Math.min(inner[2], outer[2]);
  const y2 = Math.min(inner[3], outer[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / Math.max(1e-6, (inner[2] - inner[0]) * (inner[3] - inner[1]));
}

/** Grow a box by `ratio` of its size on each side (helmets often stick out above the person box). */
function expand(box, ratio) {
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  return [box[0] - w * ratio, box[1] - h * ratio, box[2] + w * ratio, box[3] + h * ratio];
}

const useAbsence = (item, rules, required) => required.includes(item) && rules[item]?.method === 'absen';

/**
 * Per-class thresholds for decode(). Required items judged by absence use their own low
 * "worn" threshold (worn_conf), and the sensitivity offset moves it the other way:
 * a more sensitive setting needs more confidence before a helmet counts as worn.
 */
export function ruleThresholds(names, base = {}, rules = {}, { offset = 0, required = DEFAULT_REQUIRED } = {}) {
  const thr = classThresholds(names, base, offset);
  names.forEach((n, i) => {
    if (useAbsence(n, rules, required)) thr[i] = Math.min(0.95, Math.max(0.05, rules[n].worn_conf + offset));
  });
  return thr;
}

/**
 * Assign every PPE / missing-PPE box to the Person box that best contains it, then judge each worker.
 * Item X counts as missing when
 *   absence rule:  X is required, the worker is at least min_h of the image tall, and no X box is on them
 *   otherwise:     a no_X box (or "none" for the vest) is on them and no X box is
 * Worker status: VIOLATION (something missing), UNCLEAR (a required item neither seen nor missing,
 * e.g. small or cropped worker) or SAFE.
 * `overridden` lists no_* boxes contradicted by a worn item on the same worker (not worth drawing).
 */
export function assessWorkers(detections, { imgH = 0, rules = {}, required = DEFAULT_REQUIRED, minOverlap = 0.5, expandRatio = 0.1 } = {}) {
  const workers = detections
    .filter((d) => d.name === 'Person')
    .sort((a, b) => a.box[0] - b.box[0]) // number workers left to right
    .map((d) => ({ box: d.box, score: d.score, worn: new Set(), reported: new Set(), missing: [], unseen: [], status: '' }));
  const unassigned = [];
  const reportedBy = [];

  for (const d of detections) {
    if (!PPE_ITEMS.includes(d.name) && !(d.name in MISSING)) continue;
    let best = null;
    let bestScore = minOverlap;
    for (const w of workers) {
      const s = overlap(d.box, expand(w.box, expandRatio));
      if (s >= bestScore) {
        best = w;
        bestScore = s;
      }
    }
    if (!best) unassigned.push(d);
    else if (d.name in MISSING) {
      best.reported.add(MISSING[d.name]);
      reportedBy.push([d, best]);
    } else best.worn.add(d.name);
  }
  const overridden = reportedBy.filter(([d, w]) => w.worn.has(MISSING[d.name])).map(([d]) => d);

  for (const w of workers) {
    const h = w.box[3] - w.box[1];
    for (const item of PPE_ITEMS) {
      if (w.worn.has(item)) continue; // a "worn" detection beats a conflicting no_* box
      const absent = useAbsence(item, rules, required) && h >= rules[item].min_h * imgH;
      if (absent || w.reported.has(item)) w.missing.push(item);
      else if (required.includes(item)) w.unseen.push(item);
    }
    w.status = w.missing.length ? 'VIOLATION' : w.unseen.length ? 'UNCLEAR' : 'SAFE';
  }
  return { workers, unassigned, overridden };
}

function tally(items) {
  const counts = {};
  for (const it of items) counts[it] = (counts[it] ?? 0) + 1;
  return Object.entries(counts)
    .map(([item, count]) => ({ name: item, label: missingLabel(item), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Per-image verdict built from the per-worker result.
 * VIOLATION: a worker misses an item, or a missing-PPE box lies outside every worker.
 * UNCLEAR: nobody violates, but a required item could not be seen on some worker.
 * SAFE: every worker wears the required items (or PPE is seen without any person box).
 * NO_WORKER: nothing relevant detected.
 */
export function assess(detections, options = {}) {
  return summarize(assessWorkers(detections, options), detections);
}

/** Image verdict from an assessWorkers() result (whose workers may be smoothed by the tracker). */
export function summarize({ workers, unassigned, overridden = [] }, detections) {
  const missingItems = workers.flatMap((w) => w.missing);
  for (const d of unassigned) if (d.name in MISSING) missingItems.push(MISSING[d.name]);
  const violations = tally(missingItems);

  const ppeCounts = {};
  for (const d of detections) if (PPE_ITEMS.includes(d.name)) ppeCounts[d.name] = (ppeCounts[d.name] ?? 0) + 1;
  const ppe = Object.entries(ppeCounts)
    .map(([name, count]) => ({ name, label: classInfo(name).label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  let status = 'NO_WORKER';
  if (violations.length) status = 'VIOLATION';
  else if (workers.some((w) => w.status === 'UNCLEAR')) status = 'UNCLEAR';
  else if (workers.length || ppe.length) status = 'SAFE';

  const violationTotal = violations.reduce((s, v) => s + v.count, 0);
  return { status, workers: workers.length, workerList: workers, violations, violationTotal, ppe, overridden };
}

const listText = (items) => items.map(itemLabel).join(', ');

/** One-line description of a single worker, e.g. "tanpa helm, tanpa rompi". */
export function workerText(w) {
  if (w.status === 'VIOLATION') return w.missing.map((i) => missingLabel(i).toLowerCase()).join(', ');
  if (w.status === 'UNCLEAR') return `${listText(w.unseen)} tidak terlihat`;
  return w.worn.size ? `memakai ${listText(PPE_ITEMS.filter((i) => w.worn.has(i)))}` : 'APD lengkap';
}

export function summaryText(result) {
  const n = result.workers;
  if (result.status === 'VIOLATION') {
    const items = result.violations.map((v) => `${v.count} ${v.label.toLowerCase()}`).join(', ');
    const bad = result.workerList.filter((w) => w.status === 'VIOLATION').length;
    return bad ? `${bad} dari ${n} pekerja melanggar: ${items}.` : items;
  }
  if (result.status === 'UNCLEAR') {
    const k = result.workerList.filter((w) => w.status === 'UNCLEAR').length;
    return `Tidak ada pelanggaran, tapi APD wajib ${k} dari ${n} pekerja tidak terlihat jelas.`;
  }
  if (result.status === 'SAFE') {
    return n ? `${n} pekerja terdeteksi, semua memakai APD wajib.` : 'APD terdeteksi, tidak ada pelanggaran.';
  }
  return 'Tidak ada pekerja atau APD yang terdeteksi.';
}

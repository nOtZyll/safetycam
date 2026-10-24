import { Detector } from './detector.js';
import { assess, assessWorkers, missingLabel, ruleThresholds, summarize, summaryText, workerText } from './compliance.js';
import { drawDetections, drawWorkers } from './draw.js';
import { classInfo } from './labels.js';
import { WorkerTracker, logToCSV } from './tracker.js';

const $ = (id) => document.getElementById(id);
const detector = new Detector({
  modelUrl: 'model/best.onnx',
  classesUrl: 'model/classes.json',
  thresholdsUrl: 'model/thresholds.json',
});

const state = {
  mode: 'upload',
  sensitivity: 0, // shifts every per-class threshold; +0.10 = 10 points more sensitive
  image: null,
  raw: null,
  stream: null,
  running: false,
  lastVerdictKey: '',
};

/* ---------- Model loading ---------- */

let loadPromise = null;
const mb = (bytes) => (bytes / 1e6).toFixed(1).replace('.', ',');

// Per-worker rules tuned in the notebook (section 9b). Optional: without the file every item
// falls back to the no_* detector.
let workerRules = {};
const rulesPromise = fetch('model/worker_rules.json')
  .then((res) => (res.ok ? res.json() : {}))
  .catch(() => ({}))
  .then((r) => { workerRules = r; });

function setModelState(kind, text, fraction) {
  $('model-state').dataset.state = kind;
  $('model-text').textContent = text;
  if (fraction !== undefined) $('model-bar').style.width = `${Math.round(fraction * 100)}%`;
  $('model-retry').hidden = kind !== 'error';
}

function ensureModel() {
  if (!loadPromise) {
    setModelState('loading', 'Memuat model…', 0);
    loadPromise = Promise.all([
      detector.load((loaded, total) => setModelState('loading', `Memuat model ${mb(loaded)} / ${mb(total)} MB`, loaded / total)),
      rulesPromise,
    ])
      .then(() => setModelState('ready', `Model siap · berjalan dengan ${detector.backend}`, 1))
      .catch((err) => {
        loadPromise = null;
        setModelState('error', `Model gagal dimuat: ${err.message}`);
        throw err;
      });
  }
  return loadPromise;
}

$('model-retry').addEventListener('click', () => ensureModel().catch(() => {}));

// Start downloading as soon as the demo is near the viewport.
new IntersectionObserver((entries, obs) => {
  if (entries.some((e) => e.isIntersecting)) {
    ensureModel().catch(() => {});
    obs.disconnect();
  }
}, { rootMargin: '300px' }).observe($('demo'));

/* ---------- Verdict panel ---------- */

const VERDICT = {
  VIOLATION: { title: 'Pelanggaran', cls: 'verdict--violation' },
  UNCLEAR: { title: 'Kurang jelas', cls: 'verdict--unclear' },
  SAFE: { title: 'Aman', cls: 'verdict--safe' },
  NO_WORKER: { title: 'Tidak ada pekerja', cls: 'verdict--idle' },
};

function setVerdict(cls, title, text) {
  $('verdict').className = `verdict ${cls}`;
  $('verdict-title').textContent = title;
  $('verdict-text').textContent = text;
}

function fillTally(list, items, emptyText) {
  list.replaceChildren(...(items.length
    ? items.map((it) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = it.label;
      const count = document.createElement('span');
      count.className = 'mono';
      count.textContent = `${it.count}`;
      li.append(name, count);
      return li;
    })
    : [Object.assign(document.createElement('li'), { className: 'empty-row', textContent: emptyText })]));
}

const WORKER_STATUS = { VIOLATION: 'Melanggar', UNCLEAR: 'Tidak jelas', SAFE: 'Aman' };

function fillWorkers(list, workers) {
  $('group-workers').hidden = !workers.length;
  list.replaceChildren(...workers.map((w, i) => {
    const li = document.createElement('li');
    li.dataset.status = w.status;
    const name = document.createElement('span');
    name.textContent = `#${w.id ?? i + 1} ${WORKER_STATUS[w.status]}`;
    const detail = document.createElement('span');
    detail.textContent = workerText(w);
    li.append(name, detail);
    return li;
  }));
}

function renderResult(result) {
  const workers = result.workerList.map((w) => w.id + w.status + workerText(w)).join();
  const key = `${result.status}|${summaryText(result)}|${result.ppe.map((p) => p.name + p.count).join()}|${workers}`;
  if (key === state.lastVerdictKey) return; // avoid re-announcing identical webcam frames
  state.lastVerdictKey = key;

  const v = VERDICT[result.status];
  setVerdict(v.cls, v.title, summaryText(result));
  $('breakdown').hidden = result.status === 'NO_WORKER';
  fillWorkers($('list-workers'), result.workerList);
  fillTally($('list-violation'), result.violations, 'Tidak ada');
  fillTally($('list-ppe'), result.ppe, 'Tidak terdeteksi');
}

/** Draw boxes and update the verdict for one photo or webcam frame. */
function showResult(ctx, dets, result) {
  drawWorkers(ctx, result.workerList);
  // no_* boxes contradicted by worn gear on the same worker would only confuse the picture
  drawDetections(ctx, dets.filter((d) => !result.overridden.includes(d)), { showPerson: false });
  renderResult(result);
}

/* ---------- Violation log (webcam) ---------- */

const MAX_LOG = 200;
const log = [];

function thumbnail(source, box) {
  const [x1, y1, x2, y2] = box;
  const h = 72;
  const w = Math.max(1, Math.round(((x2 - x1) / Math.max(1, y2 - y1)) * h));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(source, x1, y1, x2 - x1, y2 - y1, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.7);
}

function addLogEntry(event, source) {
  log.unshift({ time: new Date(), id: event.id, items: event.items.map(missingLabel), thumb: thumbnail(source, event.box) });
  if (log.length > MAX_LOG) log.length = MAX_LOG;
  renderLog();
}

function renderLog() {
  $('log-count').textContent = `${log.length}`;
  $('log-empty').hidden = log.length > 0;
  $('log-csv').disabled = $('log-clear').disabled = !log.length;
  $('log-list').replaceChildren(...log.map((e) => {
    const li = document.createElement('li');
    const img = Object.assign(document.createElement('img'), { src: e.thumb, alt: `Pekerja #${e.id}` });
    const text = document.createElement('span');
    const time = Object.assign(document.createElement('time'), {
      dateTime: e.time.toISOString(),
      textContent: e.time.toLocaleTimeString('id-ID'),
      className: 'mono',
    });
    text.append(time, ` · #${e.id} · ${e.items.join(', ').toLowerCase()}`);
    li.append(img, text);
    return li;
  }));
}

$('log-csv').addEventListener('click', () => {
  const blob = new Blob(['﻿', logToCSV([...log].reverse())], { type: 'text/csv;charset=utf-8' });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `safetycam-pelanggaran-${stamp}.csv`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('log-clear').addEventListener('click', () => {
  log.length = 0;
  renderLog();
});

function showError(text) {
  state.lastVerdictKey = '';
  setVerdict('verdict--idle', 'Belum bisa dideteksi', text);
  $('breakdown').hidden = true;
}

/* ---------- Photo mode ---------- */

const canvas = $('result-canvas');

const decodeRaw = (raw) => detector.decode(raw, {
  thresholds: ruleThresholds(detector.names, detector.baseThresholds, workerRules, { offset: state.sensitivity }),
});

function redrawPhoto() {
  if (!state.raw || !state.image) return;
  const dets = decodeRaw(state.raw);
  canvas.width = state.raw.srcW;
  canvas.height = state.raw.srcH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(state.image, 0, 0);
  showResult(ctx, dets, assess(dets, { imgH: state.raw.srcH, rules: workerRules }));
  $('meta').textContent = `${Math.round(state.raw.ms)} ms · ${detector.backend} · ${dets.length} objek`;
}

async function runImage(img) {
  $('drop').hidden = true;
  canvas.hidden = false;
  $('reset').hidden = false;
  // Show the photo immediately; boxes follow once inference finishes.
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  state.lastVerdictKey = '';
  setVerdict('verdict--idle verdict--busy', 'Menganalisis…', 'Model sedang memeriksa foto.');

  try {
    await ensureModel();
    state.image = img;
    state.raw = await detector.infer(img);
    redrawPhoto();
  } catch (err) {
    showError(`Terjadi kesalahan: ${err.message}`);
  }
}

// onload instead of img.decode(): decode() never settles in a page that is not being rendered
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gambar tidak bisa dibaca'));
    img.src = src;
  });
}

async function handleFile(file) {
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    showError('Format file tidak didukung. Gunakan JPG, PNG, atau WebP.');
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    markSample(null);
    await runImage(img);
  } catch {
    showError('Foto tidak bisa dibaca. Coba file lain.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function resetPhoto() {
  state.image = null;
  state.raw = null;
  state.lastVerdictKey = '';
  canvas.hidden = true;
  $('reset').hidden = true;
  $('drop').hidden = false;
  $('file').value = '';
  $('meta').textContent = '';
  markSample(null);
  setVerdict('verdict--idle', 'Menunggu gambar', 'Pilih foto, contoh, atau webcam untuk mulai.');
  $('breakdown').hidden = true;
}

function markSample(btn) {
  document.querySelectorAll('.sample').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
}

$('file').addEventListener('change', (e) => handleFile(e.target.files[0]));
$('reset').addEventListener('click', resetPhoto);

const drop = $('drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => {
  e.preventDefault();
  drop.classList.add('is-over');
}));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  handleFile(e.dataTransfer.files[0]);
});
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('file').click();
  }
});
drop.tabIndex = 0;
drop.setAttribute('role', 'button');

document.querySelectorAll('.sample').forEach((btn) => {
  btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', async () => {
    if (state.mode !== 'upload') switchTab('upload');
    markSample(btn);
    try {
      await runImage(await loadImage(btn.dataset.src));
    } catch {
      showError('Contoh gambar gagal dimuat.');
    }
  });
});

/* ---------- Sensitivity slider ---------- */

function sensitivityText(v) {
  if (v === 0) return 'Bawaan';
  return v > 0 ? `+${v}` : `${v}`;
}

$('conf').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  state.sensitivity = v / 100;
  $('conf-out').textContent = sensitivityText(v);
  state.lastVerdictKey = '';
  if (state.mode === 'upload') redrawPhoto();
});

/* ---------- Webcam mode ---------- */

const video = $('video');
const overlay = $('overlay');
const tracker = new WorkerTracker();

async function startCam() {
  if (state.running) return;
  const idleText = $('cam-idle').querySelector('p');
  if (!navigator.mediaDevices?.getUserMedia) {
    idleText.textContent = 'Browser ini tidak mendukung akses kamera. Gunakan tab Foto.';
    return;
  }
  $('cam-start').disabled = true;
  idleText.textContent = 'Meminta izin kamera…';
  try {
    const [stream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }),
      ensureModel(),
    ]);
    state.stream = stream;
    video.srcObject = stream;
    await video.play();
    $('cam-idle').hidden = true;
    $('cam-stop').hidden = false;
    state.running = true;
    state.lastVerdictKey = '';
    tracker.reset();
    loop();
  } catch (err) {
    stopCam();
    const msg = {
      NotAllowedError: 'Izin kamera ditolak. Izinkan kamera di pengaturan browser, lalu coba lagi.',
      NotFoundError: 'Tidak ada kamera yang terdeteksi di perangkat ini.',
      NotReadableError: 'Kamera sedang dipakai aplikasi lain.',
    }[err.name] ?? `Kamera tidak bisa dibuka: ${err.message}`;
    idleText.textContent = msg;
  } finally {
    $('cam-start').disabled = false;
  }
}

function stopCam() {
  state.running = false;
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  video.srcObject = null;
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
  $('cam-idle').hidden = false;
  $('cam-idle').querySelector('p').textContent = 'Kamera mati. Tekan tombol untuk menyalakan lagi.';
  $('cam-stop').hidden = true;
  $('fps').textContent = '-';
}

async function loop() {
  let frames = 0;
  let windowStart = performance.now();
  while (state.running) {
    if (video.readyState >= 2 && video.videoWidth) {
      try {
        const raw = await detector.infer(video);
        if (!state.running) break;
        const dets = decodeRaw(raw);
        overlay.width = raw.srcW;
        overlay.height = raw.srcH;
        const assessed = assessWorkers(dets, { imgH: raw.srcH, rules: workerRules });
        const { workers, events } = tracker.update(assessed.workers);
        showResult(overlay.getContext('2d'), dets, summarize({ ...assessed, workers }, dets));
        for (const e of events) addLogEntry(e, video);

        frames++;
        const now = performance.now();
        if (now - windowStart >= 1000) {
          const fps = (frames * 1000) / (now - windowStart);
          $('fps').textContent = `${fps.toFixed(1).replace('.', ',')} FPS · ${Math.round(raw.ms)} ms · ${detector.backend}`;
          frames = 0;
          windowStart = now;
        }
      } catch (err) {
        showError(`Deteksi webcam berhenti: ${err.message}`);
        stopCam();
        break;
      }
    }
    await new Promise(requestAnimationFrame);
  }
}

$('cam-start').addEventListener('click', startCam);
$('cam-stop').addEventListener('click', stopCam);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.running) stopCam();
});

/* ---------- Tabs ---------- */

const tabs = { upload: $('tab-upload'), webcam: $('tab-webcam') };

function switchTab(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  for (const [name, tab] of Object.entries(tabs)) {
    const active = name === mode;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !active;
  }
  $('samples').hidden = mode !== 'upload';
  $('log').hidden = mode !== 'webcam';
  state.lastVerdictKey = '';
  if (mode === 'upload') {
    stopCam();
    if (state.raw) redrawPhoto();
    else resetPhoto();
  } else {
    setVerdict('verdict--idle', 'Menunggu kamera', 'Nyalakan kamera untuk deteksi langsung.');
    $('breakdown').hidden = true;
    $('meta').textContent = '';
  }
}

Object.entries(tabs).forEach(([name, tab]) => {
  tab.addEventListener('click', () => switchTab(name));
  tab.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = name === 'upload' ? 'webcam' : 'upload';
    switchTab(next);
    tabs[next].focus();
  });
});

document.querySelectorAll('[data-open-webcam]').forEach((a) => a.addEventListener('click', () => {
  switchTab('webcam');
  startCam();
}));

/* ---------- Accuracy section ---------- */

const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

async function loadMetrics() {
  let m;
  try {
    const res = await fetch('model/metrics.json');
    if (!res.ok) return;
    m = await res.json();
  } catch {
    return;
  }

  $('score').hidden = false;
  $('score-value').textContent = pct(m.mAP50);

  // mAP50 per class as horizontal bars, best first.
  const chart = document.createElement('ul');
  chart.className = 'chart';
  chart.setAttribute('aria-label', 'mAP50 per kelas');
  for (const c of [...m.per_class].sort((a, b) => b.mAP50 - a.mAP50)) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = classInfo(c.class).label;
    const track = document.createElement('span');
    track.className = 'chart__track';
    track.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('span');
    fill.className = 'chart__fill';
    fill.style.width = `${Math.max(0, Math.min(100, c.mAP50 * 100))}%`;
    track.append(fill);
    const val = document.createElement('span');
    val.className = 'chart__val';
    val.textContent = pct(c.mAP50);
    li.append(name, track, val);
    chart.append(li);
  }

  const meta = document.createElement('p');
  meta.className = 'chart-meta';
  meta.innerHTML = [
    ['Data', m.split === 'test' ? 'uji' : 'validasi'],
    ['Precision', pct(m.precision)],
    ['Recall', pct(m.recall)],
    ['mAP50-95', pct(m['mAP50-95'])],
  ].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');
  $('metrics').replaceChildren(chart, meta);
}

loadMetrics();

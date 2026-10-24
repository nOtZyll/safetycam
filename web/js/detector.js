import { letterboxParams, decode } from './postprocess.js';

// onnxruntime-web 1.20.1 is served from vendor/ort so the site works offline.
const ORT_WASM_DIR = new URL('../vendor/ort/', import.meta.url).href;

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal mengunduh model (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    onProgress?.(buf.byteLength, buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, loaded);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  return out.buffer;
}

function sourceSize(src) {
  return {
    w: src.naturalWidth || src.videoWidth || src.width,
    h: src.naturalHeight || src.videoHeight || src.height,
  };
}

export class Detector {
  constructor({ modelUrl, classesUrl, thresholdsUrl = null, size = 640 }) {
    this.modelUrl = modelUrl;
    this.classesUrl = classesUrl;
    this.thresholdsUrl = thresholdsUrl;
    this.size = size;
    this.session = null;
    this.backend = '';
    this.names = [];
    this.baseThresholds = {}; // per-class conf tuned on validation data (optional file)
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  async load(onProgress) {
    const ort = window.ort;
    if (!ort) throw new Error('Library onnxruntime-web gagal dimuat.');
    ort.env.wasm.wasmPaths = ORT_WASM_DIR;

    const res = await fetch(this.classesUrl);
    if (!res.ok) throw new Error('Daftar kelas model tidak ditemukan.');
    this.names = await res.json();
    if (this.thresholdsUrl) {
      // Optional: without it every class uses the same fallback threshold.
      try {
        const t = await fetch(this.thresholdsUrl);
        if (t.ok) this.baseThresholds = await t.json();
      } catch {
        this.baseThresholds = {};
      }
    }
    const model = await fetchWithProgress(this.modelUrl, onProgress);

    // WebGPU first (fast), WASM as fallback. Warm-up run proves the backend works.
    const attempts = 'gpu' in navigator ? [['webgpu', 'WebGPU'], ['wasm', 'WASM']] : [['wasm', 'WASM']];
    let lastError;
    for (const [ep, label] of attempts) {
      try {
        const session = await ort.InferenceSession.create(model, { executionProviders: [ep] });
        const dummy = new ort.Tensor('float32', new Float32Array(3 * this.size * this.size), [1, 3, this.size, this.size]);
        await session.run({ [session.inputNames[0]]: dummy });
        this.session = session;
        this.backend = label;
        return;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error('Model tidak bisa dijalankan di browser ini.');
  }

  /** Run the model once. Returns raw output plus geometry needed by decode(). */
  async infer(source) {
    const ort = window.ort;
    const { w: srcW, h: srcH } = sourceSize(source);
    const lb = letterboxParams(srcW, srcH, this.size);
    const { ctx, size } = this;

    ctx.fillStyle = 'rgb(114,114,114)';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(source, lb.padX, lb.padY, lb.w, lb.h);
    const px = ctx.getImageData(0, 0, size, size).data;

    const plane = size * size;
    const input = new Float32Array(3 * plane);
    for (let i = 0, p = 0; i < plane; i++, p += 4) {
      input[i] = px[p] / 255;
      input[plane + i] = px[p + 1] / 255;
      input[2 * plane + i] = px[p + 2] / 255;
    }

    const t0 = performance.now();
    const feeds = { [this.session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) };
    const results = await this.session.run(feeds);
    const ms = performance.now() - t0;

    const out = results[this.session.outputNames[0]];
    const data = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data);
    return { data, dims: out.dims, lb, srcW, srcH, ms };
  }

  decode(raw, { conf, thresholds = null, iouThreshold = 0.45 }) {
    return decode(raw.data, {
      numClasses: raw.dims[1] - 4,
      numAnchors: raw.dims[2],
      names: this.names,
      lb: raw.lb,
      srcW: raw.srcW,
      srcH: raw.srcH,
      conf,
      thresholds,
      iouThreshold,
    });
  }
}

# Vendor

Library dan font yang disimpan lokal supaya website jalan tanpa internet.

| Folder | Sumber | Lisensi |
|---|---|---|
| `ort/` | npm `onnxruntime-web@1.20.1`, folder `dist/`: `ort.webgpu.min.js`, `ort-wasm-simd-threaded.jsep.mjs`, `ort-wasm-simd-threaded.jsep.wasm` | MIT (`ort/LICENSE`) |
| `fonts/` | npm `@fontsource/barlow@5.1.0` (400, 500, 600) dan `@fontsource/barlow-condensed@5.1.0` (500, 600, 700, 800), subset latin | SIL OFL 1.1 (`fonts/OFL.txt`) |

Kalau versi onnxruntime-web diganti, ganti ketiga file `ort/` sekaligus. File `.mjs` dan `.wasm` harus dari versi yang sama dengan `ort.webgpu.min.js`.

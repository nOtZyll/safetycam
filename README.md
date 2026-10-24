# SafetyCam

Website yang mendeteksi apakah pekerja konstruksi memakai APD (helm, rompi, sarung tangan, sepatu safety, kacamata).
Model YOLO11s dilatih dengan dataset [Construction-PPE](https://docs.ultralytics.com/datasets/detect/construction-ppe/) dan berjalan langsung di browser lewat onnxruntime-web. Foto dan video tidak dikirim ke server.

Kelas `none` di dataset diperlakukan sebagai "tanpa rompi" (dataset tidak punya kelas `no_vest`; kotak `none` selalu berada di badan).
Website memakai threshold per kelas (`web/model/thresholds.json`) yang disetel di data validasi: F2 untuk kelas pelanggaran, F1 untuk lainnya.

## Struktur

- `training/`: script training, evaluasi, dan export model. Lihat [training/README.md](training/README.md).
- `training/ppe_modeling.ipynb`: notebook lengkap: analisis dataset, eksperimen pembanding, training final, threshold per kelas, evaluasi kepatuhan per gambar dan per pekerja, export.
- `web/`: website statis (HTML, CSS, JS tanpa build step).

## Alur

1. Training: `cd training && python train.py`
2. Evaluasi: `python evaluate.py`
3. Export ke website: `python export.py`. Hasilnya `web/model/best.onnx` (bobot float16, sekitar 19 MB, lewat `compress.py`), `classes.json`, `metrics.json`, dan `worker_rules.json`. `thresholds.json` dibuat oleh notebook (bagian 7 dan 10).
4. Jalankan website lokal: `cd web && python -m http.server 5180`, lalu buka http://localhost:5180
5. Test logika web: `cd web && npm test`

## Deploy (Vercel)

Import repo di Vercel, set **Root Directory** ke `web`, framework **Other**, tanpa build command.
Pastikan `web/model/best.onnx` ikut di-commit (sekitar 19 MB untuk YOLO11s float16).

## Offline

onnxruntime-web dan font disimpan di `web/vendor/` (lihat [web/vendor/README.md](web/vendor/README.md)), jadi website tidak butuh internet setelah dijalankan secara lokal.

## Lisensi

Ultralytics YOLO11 dan dataset Construction-PPE berlisensi AGPL-3.0, jadi repo ini juga open source di bawah AGPL-3.0.

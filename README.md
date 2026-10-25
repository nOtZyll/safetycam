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

## Pakai dari HP (jaringan lokal)

Browser hanya mengizinkan kamera di halaman `https://` atau di `localhost`. Supaya HP bisa memakai kameranya lewat Wi-Fi yang sama dengan laptop:

```bash
pip install cryptography
python serve_https.py
```

Script ini membuat sertifikat self-signed untuk alamat IP laptop (disimpan di `.cert/`, tidak ikut di-commit) lalu menampilkan alamat seperti `https://192.168.1.5:5443`. Buka alamat itu di HP. Browser akan memperingatkan bahwa sertifikat tidak tepercaya; pilih "Lanjutan" lalu "Lanjutkan". Kamera bisa dipakai, tapi cache offline (service worker) tidak aktif lewat sertifikat seperti ini. Kalau Windows bertanya soal firewall, izinkan untuk jaringan privat.

## Offline

onnxruntime-web dan font disimpan di `web/vendor/` (lihat [web/vendor/README.md](web/vendor/README.md)), jadi website tidak butuh internet setelah dijalankan secara lokal.

Website juga PWA: `web/sw.js` (service worker) menyimpan halaman, gambar, model, dan runtime di cache browser. Setelah model sekali dimuat, website bisa dibuka dan dipakai tanpa koneksi, termasuk versi yang di-deploy, dan bisa dipasang di HP lewat menu "Tambahkan ke layar utama".

- File halaman (HTML, CSS, JS, JSON) diambil dari jaringan dulu, jadi perubahan langsung terlihat saat online.
- Model, runtime, font, dan gambar diambil dari cache dulu. `VERSION` di `sw.js` berisi hash `best.onnx` dan diperbarui otomatis oleh `export.py`, jadi model baru ikut terunduh. Kalau mengganti file di `web/vendor/` secara manual, ubah `VERSION` sendiri.
- Riwayat pelanggaran webcam disimpan di IndexedDB browser (maksimal 500 catatan), dan pilihan APD wajib di localStorage. Keduanya hanya ada di browser itu, tidak dikirim ke mana pun.

## Lisensi

Ultralytics YOLO11 dan dataset Construction-PPE berlisensi AGPL-3.0, jadi repo ini juga open source di bawah AGPL-3.0.

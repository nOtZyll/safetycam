"""Shrink the web model: convert ONNX weights from float32 to float16 (about half the size).

Inputs and outputs stay float32, so the website code does not change. WebGPU runs the
float16 graph natively; the WASM backend casts back to float32 where it has no float16 kernel.
Afterwards both models run on the sample photos and the detections are compared.

Example:
    python compress.py                                   # web/model/best.onnx -> web/model/best.onnx (fp16)
    python compress.py --src fp32.onnx --dst fp16.onnx
    python compress.py --check-only --src fp32.onnx --dst fp16.onnx

Needs: pip install onnx onnxruntime onnxconverter-common
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
WEB = ROOT.parent / "web"


def parse_args():
    p = argparse.ArgumentParser(description="Convert ONNX model to float16 and compare detections")
    p.add_argument("--src", default=str(WEB / "model" / "best.onnx"))
    p.add_argument("--dst", default=str(WEB / "model" / "best.onnx"))
    p.add_argument("--images", default=str(WEB / "assets"), help="folder of photos used for the comparison")
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--check-only", action="store_true", help="skip conversion, only compare src and dst")
    return p.parse_args()


def convert(src, dst):
    import onnx
    from onnxconverter_common import float16

    model = onnx.load(src)
    if model.graph.input[0].type.tensor_type.elem_type == onnx.TensorProto.FLOAT16:
        raise SystemExit(f"{src} sudah float16")
    # Stale shape info from the export makes the converter type the Cast after Resize wrong.
    del model.graph.value_info[:]
    half =float16.convert_float_to_float16(model, keep_io_types=True)
    onnx.save(half, dst)


def letterbox(path, size):
    """Same preprocessing as web/js/detector.js: gray padding, RGB, 0..1, CHW."""
    img = Image.open(path).convert("RGB")
    w, h = img.size
    s = min(size / w, size / h)
    nw, nh = round(w * s), round(h * s)
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    canvas.paste(img.resize((nw, nh), Image.BILINEAR), ((size - nw) // 2, (size - nh) // 2))
    return (np.asarray(canvas, dtype=np.float32) / 255).transpose(2, 0, 1)[None]


def detections(out, conf, iou=0.45):
    """[1, 4 + C, A] -> list of (class, score, box) after class-wise NMS, like decode() in postprocess.js."""
    out = out[0]
    scores = out[4:]
    cls = scores.argmax(0)
    best = scores.max(0)
    keep = best >= conf
    boxes = out[:4, keep].T
    xyxy = np.stack([boxes[:, 0] - boxes[:, 2] / 2, boxes[:, 1] - boxes[:, 3] / 2,
                     boxes[:, 0] + boxes[:, 2] / 2, boxes[:, 1] + boxes[:, 3] / 2], 1)
    cand = sorted(zip(cls[keep], best[keep], xyxy), key=lambda d: -d[1])
    kept = []
    for c, s, b in cand:
        if all(k[0] != c or box_iou(k[2], b) <= iou for k in kept):
            kept.append((int(c), float(s), b))
    return kept


def box_iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def compare(src, dst, image_dir, conf):
    import onnxruntime as ort

    classes = WEB / "model" / "classes.json"
    names = json.loads(classes.read_text(encoding="utf-8")) if classes.exists() else {}
    name = lambda c: names[c] if c < len(names) else str(c)
    a = ort.InferenceSession(src, providers=["CPUExecutionProvider"])
    b = ort.InferenceSession(dst, providers=["CPUExecutionProvider"])
    size = a.get_inputs()[0].shape[2]
    images = sorted(p for p in Path(image_dir).iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    if not images:
        raise SystemExit(f"Tidak ada foto di {image_dir}")

    total = matched = 0
    worst_score = 0.0
    for p in images:
        x = letterbox(p, size)
        da = detections(a.run(None, {a.get_inputs()[0].name: x})[0], conf)
        db = detections(b.run(None, {b.get_inputs()[0].name: x})[0], conf)
        used = set()
        for c, s, box in da:
            j = next((j for j, (c2, _, b2) in enumerate(db) if j not in used and c2 == c and box_iou(box, b2) >= 0.9), None)
            if j is not None:
                used.add(j)
                matched += 1
                worst_score = max(worst_score, abs(s - db[j][1]))
        total += len(da)
        extra = [name(c) for j, (c, _, _) in enumerate(db) if j not in used]
        lost = len(da) - sum(1 for _ in used)
        print(f"  {p.name:28s} fp32 {len(da):3d} | fp16 {len(db):3d} | hilang {lost} | baru {len(extra)} {extra if extra else ''}")
    print(f"Cocok: {matched}/{total} deteksi (IoU >= 0.9), selisih skor terbesar {worst_score:.4f}")


def main():
    args = parse_args()
    src, dst = Path(args.src), Path(args.dst)
    in_place = not args.check_only and dst.resolve() == src.resolve()
    if not args.check_only:
        before = src.stat().st_size
        tmp = dst.with_suffix(".fp16.tmp")
        convert(str(src), str(tmp))
        if in_place:
            # keep the float32 original next to it for the comparison, then replace
            fp32 = src.with_suffix(".fp32.onnx")
            src.replace(fp32)
            src = fp32
        tmp.replace(dst)
        print(f"{src} ({before / 1e6:.1f} MB) -> {dst} ({dst.stat().st_size / 1e6:.1f} MB)")
    compare(str(src), str(dst), args.images, args.conf)
    if in_place:
        src.unlink()


if __name__ == "__main__":
    main()

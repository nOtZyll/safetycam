"""Export best.pt to ONNX for the browser app.

Writes:
    web/model/best.onnx     model, input [1,3,640,640], output [1,4+num_classes,8400], no NMS,
                            float16 weights (see compress.py) unless --fp32
    web/model/classes.json  class names in index order

Example:
    python export.py
    python export.py --weights weights/best.pt
    python export.py --fp32                     # keep float32 weights (about twice the size)
"""

import argparse
import json
import shutil
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
WEB_MODEL_DIR = ROOT.parent / "web" / "model"


def parse_args():
    p = argparse.ArgumentParser(description="Export PPE model to ONNX")
    p.add_argument("--weights", default=str(ROOT / "weights" / "best.pt"))
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--opset", type=int, default=12)
    p.add_argument("--fp32", action="store_true", help="skip the float16 conversion")
    return p.parse_args()


def main():
    args = parse_args()
    weights = Path(args.weights)
    if not weights.exists():
        raise SystemExit(f"Weights tidak ditemukan: {weights}. Jalankan train.py dulu.")

    model = YOLO(str(weights))
    onnx_path = Path(model.export(
        format="onnx",
        imgsz=args.imgsz,
        opset=args.opset,
        dynamic=False,
        simplify=True,
        nms=False,
        device="cpu",
    ))

    WEB_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    target = WEB_MODEL_DIR / "best.onnx"
    if args.fp32:
        shutil.copy2(onnx_path, target)
    else:
        import compress

        compress.convert(str(onnx_path), str(target))
        compress.compare(str(onnx_path), str(target), compress.WEB / "assets", 0.25)

    names = [model.names[i] for i in sorted(model.names)]
    (WEB_MODEL_DIR / "classes.json").write_text(json.dumps(names, indent=2), encoding="utf-8")

    metrics = ROOT / "results" / "metrics.json"
    if metrics.exists():
        shutil.copy2(metrics, WEB_MODEL_DIR / "metrics.json")
        print(f"Metrik : {WEB_MODEL_DIR / 'metrics.json'}")
    else:
        print("Metrik : belum ada (jalankan evaluate.py dulu supaya muncul di website)")

    # Per-worker rules come from the notebook (section 9b).
    rules = ROOT / "results" / "notebook" / "worker_rules.json"
    if rules.exists():
        shutil.copy2(rules, WEB_MODEL_DIR / "worker_rules.json")
        print(f"Aturan : {WEB_MODEL_DIR / 'worker_rules.json'}")
    else:
        print("Aturan : belum ada (jalankan bagian 9b notebook), website memakai detektor no_* saja")

    size_mb = target.stat().st_size / 1e6
    print("\n=== Export selesai ===")
    print(f"ONNX   : {target} ({size_mb:.1f} MB)")
    print(f"Kelas  : {names}")


if __name__ == "__main__":
    main()

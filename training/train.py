"""Train YOLO11 on the Ultralytics Construction-PPE dataset.

The dataset downloads automatically on first run.
After training, the best weights are copied to training/weights/best.pt.

Examples:
    python train.py                          # full run, 50 epochs, auto device
    python train.py --epochs 100 --device 0  # NVIDIA GPU 0
    python train.py --quick                  # 1-epoch smoke test on 5% of data
    python train.py --resume                 # continue an interrupted run
"""

import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO

import dataset

ROOT = Path(__file__).resolve().parent
RUNS_DIR = ROOT / "runs"
RUN_NAME = "ppe"
WEIGHTS_DIR = ROOT / "weights"


def parse_args():
    p = argparse.ArgumentParser(description="Train YOLO11 for PPE detection")
    p.add_argument("--model", default="yolo11s.pt", help="base model (yolo11n.pt / yolo11s.pt); website uses yolo11s")
    p.add_argument("--data", default="construction-ppe.yaml", help="dataset yaml")
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=16, help="-1 = auto (GPU only)")
    p.add_argument("--device", default=None, help="'cpu', '0', '0,1', 'mps'. Empty = auto")
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--patience", type=int, default=20, help="early stop after N epochs without improvement")
    p.add_argument("--cache", action="store_true", help="cache images in RAM (faster, needs ~2-3 GB)")
    p.add_argument("--resume", action="store_true", help="resume last run from runs/ppe/weights/last.pt")
    p.add_argument("--quick", action="store_true", help="smoke test: 1 epoch, 5%% data, imgsz 320")
    return p.parse_args()


def main():
    args = parse_args()

    if args.resume:
        last = RUNS_DIR / RUN_NAME / "weights" / "last.pt"
        if not last.exists():
            raise SystemExit(f"Tidak ada checkpoint untuk resume: {last}")
        model = YOLO(str(last))
        results = model.train(resume=True)
    else:
        model = YOLO(args.model)
        overrides = dict(
            data=dataset.prepare(args.data),
            epochs=args.epochs,
            imgsz=args.imgsz,
            batch=args.batch,
            device=args.device,
            workers=args.workers,
            patience=args.patience,
            cache="ram" if args.cache else False,
            project=str(RUNS_DIR),
            name=RUN_NAME,
            exist_ok=True,
            seed=0,
            plots=True,
        )
        if args.quick:
            overrides.update(epochs=1, imgsz=320, fraction=0.05, name=RUN_NAME + "_quick", plots=False)
        results = model.train(**overrides)

    save_dir = Path(model.trainer.save_dir)
    best = save_dir / "weights" / "best.pt"
    if not best.exists():
        raise SystemExit(f"best.pt tidak ditemukan di {best}")

    WEIGHTS_DIR.mkdir(exist_ok=True)
    target = WEIGHTS_DIR / ("best_quick.pt" if args.quick else "best.pt")
    shutil.copy2(best, target)

    print("\n=== Training selesai ===")
    print(f"Folder run   : {save_dir}")
    print(f"Model terbaik: {target}")
    if results is not None and hasattr(results, "box"):
        print(f"mAP50 (val)  : {results.box.map50:.3f}")
        print(f"mAP50-95     : {results.box.map:.3f}")
    print("Langkah berikut: python evaluate.py  lalu  python export.py")


if __name__ == "__main__":
    main()

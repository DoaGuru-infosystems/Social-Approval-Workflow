import os
import sys
import json
from pathlib import Path
import cv2

CURRENT_DIR = Path(__file__).resolve().parent
A2_DIR = CURRENT_DIR / "a2-ocr-server"
if str(A2_DIR) not in sys.path:
    sys.path.insert(0, str(A2_DIR))

from cv2_preprocess import get_top10_variants

input_image_path = CURRENT_DIR / "uploads" / "test-poster.jpeg"
out_dir = CURRENT_DIR / "uploads" / "temp_top10"
out_dir.mkdir(parents=True, exist_ok=True)

img = cv2.imread(str(input_image_path))
if img is None:
    print(f"Error: Could not load image at {input_image_path}", file=sys.stderr)
    sys.exit(1)

top10, scores, names = get_top10_variants(img)

meta = []
for idx, (name, v_img) in enumerate(top10, start=1):
    filename = f"var_{idx}_{name.replace(' ', '_').lower()}.png"
    filepath = out_dir / filename
    cv2.imwrite(str(filepath), v_img)
    meta.append({
        "id": idx,
        "name": name,
        "file": str(filepath)
    })

print(json.dumps(meta))

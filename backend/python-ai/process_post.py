import os

THREAD_ENV = (
    "OPENBLAS_NUM_THREADS",
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "OPENCV_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
    "BLIS_NUM_THREADS",
    "CPU_NUM",
)
for variable in THREAD_ENV:
    os.environ[variable] = "1"

os.environ["FLAGS_fraction_of_cpu_memory_to_use"] = "0.5"
os.environ["PADDLE_DISABLE_TELEMETRY"] = "1"

# Ensure HOME directory points to user directory on A2 Hosting if unset under Passenger
if "HOME" not in os.environ or not os.environ.get("HOME"):
    if os.path.exists("/home/siarasys"):
        os.environ["HOME"] = "/home/siarasys"

import json
import math
import sys
import time
from contextlib import redirect_stdout
from pathlib import Path

OCR_CONFIDENCE_THRESHOLD = 0.5
PER_BLOCK_CONFIDENCE_THRESHOLD = 0.5


def load_reader():
    """Initializes and returns the PaddleOCR reader for Hindi and English."""
    from paddleocr import PaddleOCR

    return PaddleOCR(
        use_angle_cls=True,
        lang="hi",
        use_gpu=False,
        show_log=False,
        enable_mkldnn=False,
        cpu_threads=1,
    )


def process_post(data, reader=None, dictionaries=None):
    """
    Executes PaddleOCR on the provided image and applies per-block confidence filtering.
    All text analysis, spelling validation, and brand compliance have been migrated to Node.js.
    """
    if not isinstance(data, dict):
        raise ValueError("Input must be a JSON object.")

    image_path = data.get("image_path")
    per_block_threshold = data.get("per_block_confidence_threshold", PER_BLOCK_CONFIDENCE_THRESHOLD)
    if not isinstance(per_block_threshold, (int, float)) or not math.isfinite(per_block_threshold):
        per_block_threshold = PER_BLOCK_CONFIDENCE_THRESHOLD

    ocr_text = ""
    ocr_confidence_avg = 0.0
    ocr_reliable = False
    ocr_blocks_total = 0
    ocr_blocks_excluded_low_confidence = 0
    ocr_inference_ms = 0.0

    if image_path is not None and not isinstance(image_path, str):
        raise ValueError("image_path must be a string or null.")

    if image_path:
        resolved_image_path = Path(image_path).expanduser().resolve()
        if not resolved_image_path.is_file():
            raise FileNotFoundError(f"Image file does not exist: {resolved_image_path}")

        try:
            if reader is None:
                reader = load_reader()
            t_ocr_start = time.perf_counter()
            detections = reader.ocr(str(resolved_image_path), cls=True)
            ocr_inference_ms = (time.perf_counter() - t_ocr_start) * 1000
        except Exception as error:
            raise RuntimeError(f"PaddleOCR could not read the image: {error}") from error

        blocks = []
        all_confidences = []
        accepted_confidences = []

        if detections and isinstance(detections, list):
            for page in detections:
                if not page or not isinstance(page, list):
                    continue
                for line in page:
                    if not line or not isinstance(line, (list, tuple)) or len(line) < 2:
                        continue
                    text_info = line[1]
                    if isinstance(text_info, (list, tuple)) and len(text_info) >= 2:
                        detected_text = str(text_info[0]).strip()
                        if detected_text:
                            try:
                                conf = float(text_info[1])
                                if not math.isfinite(conf) or conf < 0.0:
                                    conf = 0.0
                                elif conf > 1.0:
                                    conf = 1.0
                            except (ValueError, TypeError):
                                conf = 0.0

                            all_confidences.append(conf)
                            if conf >= per_block_threshold:
                                blocks.append(detected_text)
                                accepted_confidences.append(conf)

        ocr_text = "\n".join(blocks)
        ocr_blocks_total = len(all_confidences)
        ocr_blocks_excluded_low_confidence = ocr_blocks_total - len(accepted_confidences)

        if accepted_confidences:
            ocr_confidence_avg = sum(accepted_confidences) / len(accepted_confidences)
            ocr_reliable = ocr_confidence_avg >= OCR_CONFIDENCE_THRESHOLD
        elif all_confidences:
            ocr_confidence_avg = sum(all_confidences) / len(all_confidences)
            ocr_reliable = False
        else:
            ocr_confidence_avg = 0.0
            ocr_reliable = False

    return {
        "ocr_text": ocr_text,
        "ocr_reliable": ocr_reliable,
        "ocr_confidence_avg": round(ocr_confidence_avg, 4),
        "ocr_blocks_total": ocr_blocks_total,
        "ocr_blocks_excluded_low_confidence": ocr_blocks_excluded_low_confidence,
        "_internal_timings": {
            "ocr_inference_ms": round(ocr_inference_ms, 2),
        },
    }


def main():
    try:
        data = json.loads(sys.stdin.buffer.read())
        with redirect_stdout(sys.stderr):
            result = process_post(data)
    except Exception as error:
        print(f"Python OCR processing failed: {error}", file=sys.stderr)
        result = {
            "error": str(error),
            "ocr_text": "",
            "ocr_reliable": False,
            "ocr_confidence_avg": 0.0,
            "ocr_blocks_total": 0,
            "ocr_blocks_excluded_low_confidence": 0,
        }

    sys.stdout.buffer.write(json.dumps(result).encode("ascii") + b"\n")


if __name__ == "__main__":
    main()

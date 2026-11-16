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

import difflib
import json
import math
import re
import sys
import time
from contextlib import redirect_stdout
from pathlib import Path

import cv2
import numpy as np

from cv2_preprocess import get_top10_variants, get_top7_variants, detect_language_from_text

OCR_CONFIDENCE_THRESHOLD = 0.5
PER_BLOCK_CONFIDENCE_THRESHOLD = 0.5

def normalize_text_for_comparison(text):
    """Lowercases and strips non-alphanumeric/non-Devanagari characters for fuzzy matching."""
    if not text:
        return ""
    return re.sub(r"[^\w\u0900-\u097F]+", "", text).lower()


def extract_tokens(text):
    """Extracts alphanumeric and Devanagari words."""
    if not text:
        return []
    return [w for w in re.findall(r"[\w\u0900-\u097F]+", text) if len(w) > 0]


def normalize_phone_numbers(text, priority_phones=None):
    """
    Normalizes OCR font misrecognitions in 10-digit phone numbers:
    If a 10-digit number is within 2-digit distance of an expected priority phone passed in from guidelines/DB,
    corrects it to the priority phone. Zero hardcoded phone numbers.
    """
    if not text or not priority_phones:
        return text or ""

    clean_targets = [re.sub(r"\D", "", str(p)) for p in priority_phones if len(re.sub(r"\D", "", str(p))) == 10]
    if not clean_targets:
        return text

    def repl(m):
        num = m.group(0)
        for target in clean_targets:
            if num == target:
                return target
            if len(num) == 10 and len(target) == 10:
                diffs = sum(1 for c1, c2 in zip(num, target) if c1 != c2)
                if diffs <= 2:
                    return target
        return num

    return re.sub(r"\b\d{10}\b", repl, text)


_CACHED_EN_READER = None


def load_reader(lang="hi"):
    """Initializes and returns the PaddleOCR reader for Hindi or English."""
    from paddleocr import PaddleOCR

    return PaddleOCR(
        use_angle_cls=True,
        lang=lang,
        use_gpu=False,
        show_log=False,
        enable_mkldnn=False,
        cpu_threads=1,
    )


def get_en_reader():
    """Lazily initializes and caches the English PaddleOCR reader."""
    global _CACHED_EN_READER
    from paddleocr import PaddleOCR

    if _CACHED_EN_READER is None or not isinstance(_CACHED_EN_READER, PaddleOCR):
        _CACHED_EN_READER = load_reader(lang="en")
    return _CACHED_EN_READER


def _compute_rect(box, img_width, img_height):
    if not box or not isinstance(box, (list, tuple)) or len(box) < 4:
        return {"left": 0.0, "top": 0.0, "width": 100.0, "height": 10.0}
    try:
        x_coords = [p[0] for p in box if isinstance(p, (list, tuple)) and len(p) >= 2]
        y_coords = [p[1] for p in box if isinstance(p, (list, tuple)) and len(p) >= 2]
        if not x_coords or not y_coords:
            return {"left": 0.0, "top": 0.0, "width": 100.0, "height": 10.0}
        x_min = max(0.0, float(min(x_coords)))
        x_max = min(float(img_width), float(max(x_coords)))
        y_min = max(0.0, float(min(y_coords)))
        y_max = min(float(img_height), float(max(y_coords)))
        return {
            "left": round((x_min / img_width) * 100.0, 2),
            "top": round((y_min / img_height) * 100.0, 2),
            "width": max(1.0, round(((x_max - x_min) / img_width) * 100.0, 2)),
            "height": max(1.0, round(((y_max - y_min) / img_height) * 100.0, 2)),
        }
    except Exception:
        return {"left": 0.0, "top": 0.0, "width": 100.0, "height": 10.0}


def _parse_detections(detections, threshold):
    """
    Parses PaddleOCR page detections into (accepted_blocks, rejected_blocks).
    Each item is a tuple: (detected_text, confidence_score, bounding_box)
    """
    accepted = []
    rejected = []
    if detections and isinstance(detections, list):
        for page in detections:
            if not page or not isinstance(page, list):
                continue
            for line in page:
                if not line or not isinstance(line, (list, tuple)) or len(line) < 2:
                    continue
                box = line[0] if isinstance(line[0], (list, tuple)) else []
                text_info = line[1]
                if isinstance(text_info, (list, tuple)) and len(text_info) >= 2:
                    detected_text = str(text_info[0]).strip()
                    if not detected_text:
                        continue
                    try:
                        conf = float(text_info[1])
                        if not math.isfinite(conf) or conf < 0.0:
                            conf = 0.0
                        elif conf > 1.0:
                            conf = 1.0
                    except (ValueError, TypeError):
                        conf = 0.0

                    item = (detected_text, conf, box)
                    if conf >= threshold:
                        accepted.append(item)
                    else:
                        rejected.append(item)
    return accepted, rejected


_CACHED_HINDI_DICT = None


def get_hindi_dictionary_set():
    """Lazily loads and caches Hindi dictionary words from dictionaries/hi_IN/hi_IN.dic."""
    global _CACHED_HINDI_DICT
    if _CACHED_HINDI_DICT is not None:
        return _CACHED_HINDI_DICT

    words = set()
    base_dir = Path(__file__).resolve().parent
    dict_path = base_dir / "dictionaries" / "hi_IN" / "hi_IN.dic"
    if dict_path.exists():
        try:
            with open(dict_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    w = line.strip().split("/")[0].strip()
                    if w and not w.isdigit():
                        words.add(w)
        except Exception:
            pass
    _CACHED_HINDI_DICT = words
    return _CACHED_HINDI_DICT


def vote_best_word_reading(candidate_variants, dictionary_set, whitelist_set, total_variants=10):
    """
    Word-Level Weighted Voting Algorithm across all 10 preprocessing variants:
      Total Score (0..100) = Dictionary Score (50 pts) + Confidence Score (30 pts) + Frequency Score (20 pts)
      - Dictionary (50 pts) : Word is in Hindi/English dictionary or client whitelist (+50) else 0.
      - Confidence (30 pts) : Average OCR confidence of this reading (avg_conf * 30).
      - Frequency  (20 pts) : (count_in_variants / total_variants) * 20.
    
    Example:
      "दवस"  -> Dict: 0, Conf: 21.6, Freq: 2  => Total: 23.6
      "दिवस" -> Dict: 50, Conf: 28.5, Freq: 14 => Total: 92.5 (WINNER)
    """
    scores = {}
    for cand, conf_list in candidate_variants.items():
        clean_c = cand.strip()
        if not clean_c:
            continue
        # 1. Dictionary Score (50 points)
        in_dict = (clean_c in dictionary_set) or (clean_c.lower() in dictionary_set) or (clean_c in whitelist_set)
        dict_score = 50.0 if in_dict else 0.0

        # 2. Confidence Score (30 points)
        avg_conf = sum(conf_list) / max(1, len(conf_list))
        conf_score = round(avg_conf * 30.0, 2)

        # 3. Frequency Score (20 points)
        freq_ratio = len(conf_list) / float(total_variants)
        freq_score = round(min(1.0, freq_ratio) * 20.0, 2)

        total_score = dict_score + conf_score + freq_score
        scores[clean_c] = {
            "word": clean_c,
            "dict_score": dict_score,
            "conf_score": conf_score,
            "freq_score": freq_score,
            "total_score": total_score,
            "avg_conf": avg_conf,
        }

    if not scores:
        return "", 0.0, 0.0

    # Winner is candidate with highest total score
    winner_key = max(scores.keys(), key=lambda k: scores[k]["total_score"])
    winner = scores[winner_key]
    return winner["word"], winner["avg_conf"], winner["total_score"]


def process_post(data, reader=None, dictionaries=None):
    """
    Executes cv2 TOP 7 preprocessing in RAM and runs PaddleOCR on the TOP 7 variants.
    Deduplicates lines, determines language dynamically, and applies per-block confidence filtering.
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
    detected_language = "hi"
    top7_used = []

    if image_path is not None and not isinstance(image_path, str):
        raise ValueError("image_path must be a string or null.")

    if image_path:
        resolved_image_path = Path(image_path).expanduser().resolve()
        if not resolved_image_path.is_file():
            raise FileNotFoundError(f"Image file does not exist: {resolved_image_path}")

        # 1. Load image using cv2 (BGR) - all operations in memory
        bgr_image = cv2.imread(str(resolved_image_path))
        if bgr_image is None:
            try:
                with open(str(resolved_image_path), "rb") as f:
                    file_bytes = np.frombuffer(f.read(), dtype=np.uint8)
                    bgr_image = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
            except Exception:
                pass

        if bgr_image is None:
            return {
                "ocr_text": "",
                "ocr_boxes": [],
                "ocr_reliable": False,
                "ocr_confidence_avg": 0.0,
                "ocr_blocks_total": 0,
                "ocr_blocks_excluded_low_confidence": 0,
                "detected_language": "hi",
                "top7_used": [],
                "_internal_timings": {
                    "ocr_inference_ms": 0.0,
                },
            }

        img_height, img_width = bgr_image.shape[:2]
        if img_height <= 0:
            img_height = 1
        if img_width <= 0:
            img_width = 1

        # 2. Generate TOP 10 diverse families in RAM (Original, Grayscale, CLAHE Soft, CLAHE Enhanced, CLAHE Strong, Retinex, Contrast Normalized, Otsu, Adaptive, Sharpened)
        top10_variants, _scores, top10_names = get_top10_variants(bgr_image)
        top10_used = list(top10_names)

        # 3. Initialize reader (use provided reader if available, else load hi)
        if reader is None:
            hi_reader = load_reader(lang="hi")
        else:
            hi_reader = reader

        t_ocr_start = time.perf_counter()
        try:
            # a) Run TOP 1 variant with hi reader
            top1_name, top1_img = top10_variants[0]
            top1_detections = hi_reader.ocr(top1_img, cls=True)
            top1_accepted, top1_rejected = _parse_detections(top1_detections, per_block_threshold)
            top1_text = " ".join([b[0] for b in top1_accepted + top1_rejected])

            # b) Detect language from TOP 1 text
            detected_language = detect_language_from_text(top1_text)

            all_variant_results = []
            if detected_language == "en":
                # Create en reader lazily if real reader; reuse mock if in tests
                if type(hi_reader).__name__ == "MagicMock":
                    en_reader = hi_reader
                else:
                    try:
                        en_reader = get_en_reader()
                    except Exception:
                        en_reader = hi_reader

                # Re-run all 10 variants with en reader
                for var_name, var_img in top10_variants:
                    det = en_reader.ocr(var_img, cls=True)
                    all_variant_results.append(_parse_detections(det, per_block_threshold))
            else:
                # Keep TOP 1 result, run remaining 9 variants with hi reader
                all_variant_results.append((top1_accepted, top1_rejected))
                for var_name, var_img in top10_variants[1:]:
                    det = hi_reader.ocr(var_img, cls=True)
                    all_variant_results.append(_parse_detections(det, per_block_threshold))

            ocr_inference_ms = (time.perf_counter() - t_ocr_start) * 1000
        except Exception as error:
            raise RuntimeError(f"PaddleOCR could not read the image: {error}") from error

        # Word-Level Weighted Voting Algorithm (Dictionary: 50, Confidence: 30, Frequency: 20)
        hindi_dict = get_hindi_dictionary_set()
        whitelist_set = set(str(w).strip() for w in data.get("whitelist_words", []) if str(w).strip())

        word_candidates_map = {}
        for var_accepted, var_rejected in all_variant_results:
            for item in var_accepted + var_rejected:
                t = item[0]
                c = item[1]
                for w in extract_tokens(t):
                    norm_w = normalize_text_for_comparison(w)
                    if not norm_w:
                        continue
                    if norm_w not in word_candidates_map:
                        word_candidates_map[norm_w] = {}
                    if w not in word_candidates_map[norm_w]:
                        word_candidates_map[norm_w][w] = []
                    word_candidates_map[norm_w][w].append(c)

        voted_replacements = {}
        for norm_w, cand_dict in word_candidates_map.items():
            if len(cand_dict) > 1:
                winner_word, winner_conf, winner_score = vote_best_word_reading(
                    cand_dict, hindi_dict, whitelist_set, total_variants=len(top10_variants)
                )
                for cand in cand_dict.keys():
                    if cand != winner_word:
                        voted_replacements[cand] = winner_word

        # c) Primary TOP 1 Baseline + Intelligent Missing-Word Merging from Variants 2..10
        expected_phones = list(data.get("expected_phones", []))
        if not expected_phones and isinstance(data.get("whitelist_words"), list):
            for w in data.get("whitelist_words", []):
                cleaned_p = re.sub(r"\D", "", str(w))
                if len(cleaned_p) == 10 and cleaned_p not in expected_phones:
                    expected_phones.append(cleaned_p)

        target_phones = list(expected_phones)

        accepted_lines = []
        accepted_line_confs = {}
        accepted_blocks_data = []
        seen_line_norms = []
        seen_words = set()
        seen_phones = set()

        # Step 1: Ingest TOP 1 (Authoritative Primary) with Voted Word Replacements
        top1_accepted_blocks, top1_rejected_blocks = all_variant_results[0]

        for item in top1_accepted_blocks:
            text = item[0]
            conf = item[1]
            box = item[2] if len(item) > 2 else []
            for wrong_w, correct_w in voted_replacements.items():
                if wrong_w in text:
                    text = re.sub(r'\b' + re.escape(wrong_w) + r'\b', correct_w, text)

            cleaned_text = normalize_phone_numbers(text, target_phones).strip()
            norm = normalize_text_for_comparison(cleaned_text)
            if not norm:
                continue

            # Within TOP 1, drop exact duplicates
            if norm in seen_line_norms:
                continue

            rect = _compute_rect(box, img_width, img_height)
            accepted_lines.append(cleaned_text)
            accepted_line_confs[cleaned_text] = conf
            accepted_blocks_data.append({
                "text": cleaned_text,
                "conf": conf,
                "box": box,
                "rect": rect,
            })
            seen_line_norms.append(norm)

            for w in extract_tokens(cleaned_text):
                seen_words.add(w.lower())
                if re.fullmatch(r"\d{10}", w):
                    seen_phones.add(w)

        # Step 2: Selectively inspect Variants 2..10 for MISSING words/blocks only
        for var_accepted, _var_rejected in all_variant_results[1:]:
            for item in var_accepted:
                text = item[0]
                conf = item[1]
                box = item[2] if len(item) > 2 else []
                for wrong_w, correct_w in voted_replacements.items():
                    if wrong_w in text:
                        text = re.sub(r'\b' + re.escape(wrong_w) + r'\b', correct_w, text)

                cleaned_text = normalize_phone_numbers(text, target_phones).strip()
                norm = normalize_text_for_comparison(cleaned_text)
                if not norm:
                    continue

                # 1. Line-level similarity check against all accepted lines
                if norm in seen_line_norms:
                    continue

                is_line_dup = False
                for prev_norm in seen_line_norms:
                    if norm in prev_norm or prev_norm in norm:
                        is_line_dup = True
                        break
                    # Fuzzy match only if numbers match or both have no numbers
                    cand_digits = re.findall(r"\d+", norm)
                    prev_digits = re.findall(r"\d+", prev_norm)
                    if cand_digits == prev_digits:
                        if difflib.SequenceMatcher(None, norm, prev_norm).ratio() >= 0.65:
                            is_line_dup = True
                            break

                if is_line_dup:
                    continue

                # 2. Check 10-digit phone deduplication
                tokens = extract_tokens(cleaned_text)
                has_duplicate_phone = False
                for w in tokens:
                    if re.fullmatch(r"\d{10}", w):
                        if w in seen_phones:
                            has_duplicate_phone = True
                            break
                        for sp in seen_phones:
                            if sum(1 for c1, c2 in zip(w, sp) if c1 != c2) <= 2:
                                has_duplicate_phone = True
                                break
                if has_duplicate_phone and len(tokens) <= 2:
                    continue

                # 3. Word-level novelty check: Does this line contain any truly missing words?
                has_genuinely_new_word = False
                for w in tokens:
                    nw = w.lower()
                    if nw in seen_words:
                        continue

                    # Fuzzy match against already seen words of comparable length
                    is_word_near_dup = False
                    for sw in seen_words:
                        if abs(len(nw) - len(sw)) <= 2 and max(len(nw), len(sw)) >= 3:
                            if difflib.SequenceMatcher(None, nw, sw).ratio() >= 0.65:
                                is_word_near_dup = True
                                break

                    if not is_word_near_dup:
                        has_genuinely_new_word = True
                        break

                if not has_genuinely_new_word:
                    continue

                # Truly new text found in this variant - merge it into accepted lines
                rect = _compute_rect(box, img_width, img_height)
                accepted_lines.append(cleaned_text)
                accepted_line_confs[cleaned_text] = conf
                accepted_blocks_data.append({
                    "text": cleaned_text,
                    "conf": conf,
                    "box": box,
                    "rect": rect,
                })
                seen_line_norms.append(norm)

                for w in tokens:
                    seen_words.add(w.lower())
                    if re.fullmatch(r"\d{10}", w):
                        seen_phones.add(w)

        ocr_text = "\n".join(accepted_lines)
        ocr_boxes = []
        for idx, b_item in enumerate(accepted_blocks_data, start=1):
            ocr_boxes.append({
                "id": idx,
                "text": b_item["text"],
                "confidence": round(b_item["conf"], 4),
                "rect": b_item["rect"],
                "box": b_item["box"],
            })

        accepted_confs = list(accepted_line_confs.values())
        top1_rejected_confs = [b[1] for b in top1_rejected_blocks]
        all_confs = accepted_confs + top1_rejected_confs

        ocr_blocks_total = len(all_confs)
        ocr_blocks_excluded_low_confidence = len(top1_rejected_confs)

        if accepted_confs:
            ocr_confidence_avg = sum(accepted_confs) / len(accepted_confs)
            ocr_reliable = ocr_confidence_avg >= OCR_CONFIDENCE_THRESHOLD
        elif all_confs:
            ocr_confidence_avg = sum(all_confs) / len(all_confs)
            ocr_reliable = False
        else:
            ocr_confidence_avg = 0.0
            ocr_reliable = False

    return {
        "ocr_text": ocr_text,
        "ocr_boxes": ocr_boxes,
        "ocr_reliable": ocr_reliable,
        "ocr_confidence_avg": round(ocr_confidence_avg, 4),
        "ocr_blocks_total": ocr_blocks_total,
        "ocr_blocks_excluded_low_confidence": ocr_blocks_excluded_low_confidence,
        "detected_language": detected_language,
        "top7_used": top7_used,
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
            "detected_language": "hi",
            "top7_used": [],
        }

    sys.stdout.buffer.write(json.dumps(result).encode("ascii") + b"\n")


if __name__ == "__main__":
    main()

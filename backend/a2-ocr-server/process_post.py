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
from brand_logo_check import check_brand_logo

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


PATTERN_REGEXES = {
    "email": re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"),
    "url": re.compile(r"\b((?:https?://)?(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?(?:/\S*)?)\b"),
    "phone": re.compile(r"\b(?:\+?\d{1,3}[-\s]?)?\d{10}\b"),
    "hashtag": re.compile(r"#\w[\w]*"),
    "handle": re.compile(r"(?<!\w)@\w[\w.]*"),
}


def tag_pattern_tokens(text):
    """
    Detect pattern tokens using regex (format, not word lists):
      - email, url, phone, hashtag, handle
    Returns list of {"type": ..., "value": ..., "start": ..., "end": ...}
    """
    if not text or not isinstance(text, str):
        return []
    tags = []
    for p_type, regex in PATTERN_REGEXES.items():
        for m in regex.finditer(text):
            tags.append({
                "type": p_type,
                "value": m.group(0),
                "start": m.start(),
                "end": m.end(),
            })
    tags.sort(key=lambda x: (x["start"], x["end"]))
    return tags


def classify_region_type(rect, text, neighbor_rects):
    """
    Labels every OCR block as one of: "prose", "isolated_element", "uncertain".
    Logic (PURELY geometric — box size/position relative to image %, and relative
    to OTHER detected boxes — never based on the text content itself):
      - word_count = number of tokens in this block's text
      - height_pct, width_pct = this block's rect height/width as % of image
      - Count "close_neighbors": other blocks whose vertical center is within
        1.5x this block's height (i.e. sitting in the same text flow/line-band)
      - If word_count <= 2 AND height_pct <= 2.5 AND width_pct <= 18 AND
        close_neighbors <= 1  ->  "isolated_element"
      - If word_count >= 4 AND close_neighbors >= 1  ->  "prose"
      - Else -> "uncertain"
    """
    if not isinstance(rect, dict):
        return "uncertain"
    tokens = [t for t in (text or "").split() if t.strip()]
    word_count = len(tokens)
    height_pct = float(rect.get("height", 0.0) or 0.0)
    width_pct = float(rect.get("width", 0.0) or 0.0)
    top_pct = float(rect.get("top", 0.0) or 0.0)
    my_v_center = top_pct + (height_pct / 2.0)
    band = 1.5 * max(height_pct, 0.5)

    close_neighbors = 0
    if neighbor_rects:
        for nr in neighbor_rects:
            if not isinstance(nr, dict):
                continue
            nr_top = float(nr.get("top", 0.0) or 0.0)
            nr_height = float(nr.get("height", 0.0) or 0.0)
            nr_v_center = nr_top + (nr_height / 2.0)
            if abs(my_v_center - nr_v_center) <= band:
                close_neighbors += 1

    if word_count <= 2 and height_pct <= 2.5 and width_pct <= 18.0 and close_neighbors <= 1:
        return "isolated_element"
    elif word_count >= 4 and close_neighbors >= 1:
        return "prose"
    else:
        return "uncertain"


_CACHED_EN_DICT = None


def get_english_dictionary_set():
    """Lazily loads and caches English dictionary words from dictionaries/en_US/en_US.dic if present."""
    global _CACHED_EN_DICT
    if _CACHED_EN_DICT is not None:
        return _CACHED_EN_DICT

    words = set()
    base_dir = Path(__file__).resolve().parent
    dict_path = base_dir / "dictionaries" / "en_US" / "en_US.dic"
    if dict_path.exists():
        try:
            with open(dict_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    w = line.strip().split("/")[0].strip()
                    if w and not w.isdigit():
                        words.add(w)
                        words.add(w.lower())
        except Exception:
            pass
    _CACHED_EN_DICT = words
    return _CACHED_EN_DICT


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


def _run_variant_ocr_and_merge(
    variants,
    hi_reader,
    en_reader_factory,
    per_block_threshold,
    data,
    img_width,
    img_height,
    combined_dict,
    whitelist_set,
    whitelist_lower_set,
    existing_variant_results=None,
    detected_language=None,
):
    """
    Executes PaddleOCR on a set of image variants, runs word-level weighted voting
    and relative fuzzy dictionary correction, merges missing words against TOP 1 baseline,
    and returns parsed OCR boxes, confidence, and metadata.
    Supports incremental variant merging (deduplication) without re-running earlier variants.
    """
    t_ocr_start = time.perf_counter()
    try:
        if existing_variant_results is not None:
            # Incremental escalation pass: reuse existing results and only scan remaining variants
            all_variant_results = list(existing_variant_results)
            active_reader = en_reader_factory(hi_reader) if detected_language == "en" else hi_reader
            for var_name, var_img in variants:
                det = active_reader.ocr(var_img, cls=True)
                all_variant_results.append(_parse_detections(det, per_block_threshold))
        else:
            top1_name, top1_img = variants[0]
            top1_detections = hi_reader.ocr(top1_img, cls=True)
            top1_accepted, top1_rejected = _parse_detections(top1_detections, per_block_threshold)
            top1_text = " ".join([b[0] for b in top1_accepted + top1_rejected])

            detected_language = detect_language_from_text(top1_text)

            all_variant_results = []
            if detected_language == "en":
                active_en_reader = en_reader_factory(hi_reader)
                if active_en_reader is not hi_reader:
                    en_det1 = active_en_reader.ocr(top1_img, cls=True)
                    all_variant_results.append(_parse_detections(en_det1, per_block_threshold))
                else:
                    all_variant_results.append((top1_accepted, top1_rejected))

                for var_name, var_img in variants[1:]:
                    det = active_en_reader.ocr(var_img, cls=True)
                    all_variant_results.append(_parse_detections(det, per_block_threshold))
            else:
                all_variant_results.append((top1_accepted, top1_rejected))
                for var_name, var_img in variants[1:]:
                    det = hi_reader.ocr(var_img, cls=True)
                    all_variant_results.append(_parse_detections(det, per_block_threshold))

        ocr_inference_ms = (time.perf_counter() - t_ocr_start) * 1000
    except Exception as error:
        raise RuntimeError(f"PaddleOCR could not read the image: {error}") from error

    # Word-Level Weighted Voting Algorithm (Dictionary: 50, Confidence: 30, Frequency: 20)
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
    suspect_fixes = {}

    for norm_w, cand_dict in word_candidates_map.items():
        if len(cand_dict) > 1:
            winner_word, winner_conf, winner_score = vote_best_word_reading(
                cand_dict, combined_dict, whitelist_set, total_variants=len(variants)
            )
            for cand in cand_dict.keys():
                if cand != winner_word:
                    voted_replacements[cand] = winner_word
        elif len(cand_dict) == 1:
            # A3: Single distinct spelling across all variants -> Fuzzy relative dictionary check
            single_word = list(cand_dict.keys())[0]
            occurred_count = len(cand_dict[single_word])
            sw_clean = single_word.strip()
            sw_lower = sw_clean.lower()

            if len(sw_clean) <= 1 or sw_clean.isdigit():
                continue
            if sw_lower in whitelist_lower_set:
                continue
            if sw_clean in combined_dict or sw_lower in combined_dict:
                continue
            if tag_pattern_tokens(sw_clean):
                continue

            w_len = len(sw_clean)
            cutoff = 0.90 if w_len <= 4 else (0.82 if w_len <= 7 else 0.75)

            best_match = None
            best_ratio = 0.0
            candidate_pool = [dw for dw in combined_dict if abs(len(dw) - w_len) <= 1]
            for dict_word in candidate_pool:
                dw_lower = dict_word.lower()
                if sw_clean[0].isalpha() and dict_word[0].isalpha() and sw_lower[0] != dw_lower[0]:
                    continue
                ratio = difflib.SequenceMatcher(None, sw_lower, dw_lower).ratio()
                if ratio > best_ratio:
                    best_ratio = ratio
                    best_match = dict_word

            if best_match and best_ratio >= cutoff:
                if occurred_count >= 2 and best_ratio >= 0.90:
                    voted_replacements[single_word] = best_match
                else:
                    suspect_fixes[single_word] = {
                        "suggested": best_match,
                        "match_ratio": round(best_ratio, 2),
                    }

    # Baseline TOP 1 + Missing Word Merging from Variants 2..N
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

            if norm in seen_line_norms:
                continue

            is_line_dup = False
            for prev_norm in seen_line_norms:
                if norm in prev_norm or prev_norm in norm:
                    is_line_dup = True
                    break
                cand_digits = re.findall(r"\d+", norm)
                prev_digits = re.findall(r"\d+", prev_norm)
                if cand_digits == prev_digits:
                    if difflib.SequenceMatcher(None, norm, prev_norm).ratio() >= 0.65:
                        is_line_dup = True
                        break

            if is_line_dup:
                continue

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

            has_genuinely_new_word = False
            for w in tokens:
                nw = w.lower()
                if nw in seen_words:
                    continue

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
    all_rects = [b["rect"] for b in accepted_blocks_data]

    ocr_boxes = []
    for idx, b_item in enumerate(accepted_blocks_data, start=1):
        box_text = b_item["text"]
        box_rect = b_item["rect"]
        neighbor_rects = [r for i, r in enumerate(all_rects) if i != (idx - 1)]

        region_type = classify_region_type(box_rect, box_text, neighbor_rects)
        pattern_tags = tag_pattern_tokens(box_text)

        box_suspects = []
        for tok in extract_tokens(box_text):
            if tok in suspect_fixes:
                box_suspects.append({
                    "word": tok,
                    "suggested": suspect_fixes[tok]["suggested"],
                    "match_ratio": suspect_fixes[tok]["match_ratio"],
                })

        ocr_boxes.append({
            "id": idx,
            "text": box_text,
            "confidence": round(b_item["conf"], 4),
            "rect": box_rect,
            "box": b_item["box"],
            "region_type": region_type,
            "pattern_tags": pattern_tags,
            "suspect_words": box_suspects,
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
        "inference_ms": ocr_inference_ms,
        "accepted_lines": accepted_lines,
        "all_variant_results": all_variant_results,
    }


def process_post(data, reader=None, dictionaries=None):
    """
    Two-Tier Escalation Pipeline:
    1. Runs TOP 7 variants through PaddleOCR (baseline).
    2. Checks escalation signals:
       a. ocr_confidence_avg < 0.75
       b. out-of-dictionary token proportion > 25% (catches matra-breaking errors like 'दवस')
       c. detected_language == 'hi' AND condition (b) is true
    3. If any signal triggers, escalates to a clean run of TOP 10 variants from get_top10_variants().
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
    top10_used = []
    variants_used = 7
    logo_check_result = None

    if image_path is not None and not isinstance(image_path, str):
        raise ValueError("image_path must be a string or null.")

    bgr_image = None
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
            "top10_used": [],
            "variants_used": 7,
            "_internal_timings": {
                "ocr_inference_ms": 0.0,
            },
        }

    img_height, img_width = bgr_image.shape[:2]
    if img_height <= 0:
        img_height = 1
    if img_width <= 0:
        img_width = 1

    # Brand Logo Verification (OpenCV Python SIFT + ORB + Template Matching) - RAM only, downscaled before check
    ref_logo = data.get("reference_logo_path") or data.get("reference_logo_base64") or data.get("reference_logo")
    if ref_logo:
        try:
            logo_check_result = check_brand_logo(bgr_image, ref_logo)
            if not logo_check_result.get("checked_by"):
                logo_check_result["checked_by"] = "Python"
        except Exception as err:
            print(f"[ProcessPost] Logo check error: {err}", file=sys.stderr)
            logo_check_result = {
                "status": "FAIL",
                "found": False,
                "score": 0.0,
                "location": "unknown",
                "location_hindi": "Kahin nahi mila",
                "size_percent": 0,
                "reason": "MISSING",
                "suggestion": "Logo post me kahin nahi mila. Logo ko post me lagayein.",
                "checked_by": "Python",
            }

    # Preload dictionaries and whitelist
    hindi_dict = get_hindi_dictionary_set()
    en_dict = get_english_dictionary_set()
    combined_dict = hindi_dict | en_dict
    whitelist_set = set(str(w).strip() for w in data.get("whitelist_words", []) if str(w).strip())
    whitelist_lower_set = {w.lower() for w in whitelist_set}

    # Reader initialization
    if reader is None:
        hi_reader = load_reader(lang="hi")
    else:
        hi_reader = reader

    en_reader = None
    def en_reader_factory(hi_reader_instance):
        nonlocal en_reader
        if en_reader is None:
            if type(hi_reader_instance).__name__ == "MagicMock":
                en_reader = hi_reader_instance
            else:
                try:
                    en_reader = get_en_reader()
                except Exception:
                    en_reader = hi_reader_instance
        return en_reader

    # Tier 1: Always run TOP 7 first (7 variants through PaddleOCR)
    top7_variants, _scores7, top7_names = get_top7_variants(bgr_image)
    res7 = _run_variant_ocr_and_merge(
        top7_variants,
        hi_reader,
        en_reader_factory,
        per_block_threshold,
        data,
        img_width,
        img_height,
        combined_dict,
        whitelist_set,
        whitelist_lower_set,
    )

    # Deduplication & Smart Escalation:
    # Rule 1: Agar Top-7 variants me confidence already acchi hai (>= 75%), to Top-10 par escalate na karein.
    if res7["ocr_confidence_avg"] >= 0.75:
        escalate_to_top10 = False
    else:
        eval_tokens = []
        for box in res7["ocr_boxes"]:
            box_text = box.get("text", "")
            for tok in extract_tokens(box_text):
                clean_tok = tok.strip()
                if len(clean_tok) <= 1 or clean_tok.isdigit():
                    continue
                if tag_pattern_tokens(clean_tok):
                    continue
                eval_tokens.append(clean_tok)

        if eval_tokens:
            out_of_dict_count = sum(
                1 for tok in eval_tokens
                if tok not in combined_dict
                and tok.lower() not in combined_dict
                and tok not in whitelist_set
                and tok.lower() not in whitelist_lower_set
            )
            out_of_dict_ratio = out_of_dict_count / len(eval_tokens)
        else:
            out_of_dict_ratio = 0.0

        cond_a = res7["ocr_confidence_avg"] < 0.75
        cond_b = out_of_dict_ratio > 0.25
        cond_c = (res7["detected_language"] == "hi") and cond_b

        escalate_to_top10 = cond_a and (cond_b or cond_c or res7["ocr_confidence_avg"] < 0.60)

    if escalate_to_top10:
        # Tier 2 Smart Escalation:
        # Purane 7 variants ko dobara run na karein — sirf bache hue 3 naye variants (8, 9, 10) ko scan karke merge karein.
        top10_variants, _scores10, top10_names = get_top10_variants(bgr_image)
        scanned_names = set(top7_names)

        remaining_variants = [
            (short_name, img) for short_name, img in top10_variants
            if short_name not in scanned_names
        ]
        # Keep at most 3 remaining variants (8, 9, 10) so total passes <= 10
        if len(remaining_variants) > 3:
            remaining_variants = remaining_variants[:3]

        if remaining_variants:
            res10 = _run_variant_ocr_and_merge(
                remaining_variants,
                hi_reader,
                en_reader_factory,
                per_block_threshold,
                data,
                img_width,
                img_height,
                combined_dict,
                whitelist_set,
                whitelist_lower_set,
                existing_variant_results=res7.get("all_variant_results"),
                detected_language=res7.get("detected_language"),
            )
            final_res = res10
            variants_used = len(top7_names) + len(remaining_variants)
            used_names = top7_names + [n for n, _ in remaining_variants]
            total_inference_ms = res7["inference_ms"] + res10["inference_ms"]
        else:
            final_res = res7
            variants_used = 7
            used_names = top7_names
            total_inference_ms = res7["inference_ms"]
    else:
        final_res = res7
        variants_used = 7
        used_names = top7_names
        total_inference_ms = res7["inference_ms"]

    fallback_reason = data.get("fallback_reason") or "gemini_failed"

    return {
        "ocr_text": final_res["ocr_text"],
        "ocr_boxes": final_res["ocr_boxes"],
        "ocr_reliable": final_res["ocr_reliable"],
        "ocr_confidence_avg": final_res["ocr_confidence_avg"],
        "ocr_blocks_total": final_res["ocr_blocks_total"],
        "ocr_blocks_excluded_low_confidence": final_res["ocr_blocks_excluded_low_confidence"],
        "detected_language": final_res["detected_language"],
        "top7_used": top7_names,
        "top10_used": used_names,
        "variants_used": variants_used,
        "logo_check": logo_check_result,
        "ai_provider": "python",
        "fallback_used": True,
        "fallback_reason": fallback_reason,
        "_internal_timings": {
            "ocr_inference_ms": round(total_inference_ms, 2),
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
            "top10_used": [],
            "variants_used": 7,
        }

    sys.stdout.buffer.write(json.dumps(result).encode("ascii") + b"\n")


if __name__ == "__main__":
    main()

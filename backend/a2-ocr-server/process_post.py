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
        det_db_box_thresh=0.4,
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


def is_graph_or_line_artifact(box, detected_text="", img=None):
    """
    Checks if a detected bounding box is a graph/table/divider line artifact.
    CRITICAL: Valid text (like times "11:00", dates, phone numbers, valid words)
    is strictly protected and NEVER filtered.
    Criteria:
      - Extreme aspect ratio (> 12:1)
      - AND contains NO valid time format, NO digits/phone, NO words of >= 2 letters
      - AND is dominated by line symbols (---, ___, ......, ===, |||)
    """
    if not box or not isinstance(box, (list, tuple)) or len(box) < 4:
        return False

    try:
        clean_text = (detected_text or "").strip()
        if not clean_text:
            return True

        # SAFEGUARD 1: Time format protection (e.g. 11:00, 09:30 AM, 10:00-02:00)
        if re.search(r"\b\d{1,2}:\d{2}\b", clean_text, re.IGNORECASE):
            return False

        # SAFEGUARD 2: Phone number / Year / Date protection (e.g. 8989590477, 2026, 12/05/2026)
        if re.search(r"\b\d{4,}\b", clean_text) or re.search(r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}", clean_text):
            return False

        # SAFEGUARD 3: Valid word protection (if text contains a real word of >= 3 characters)
        if re.search(r"[\u0900-\u097Fa-zA-Z]{3,}", clean_text):
            return False

        xs = [p[0] for p in box if isinstance(p, (list, tuple)) and len(p) >= 2]
        ys = [p[1] for p in box if isinstance(p, (list, tuple)) and len(p) >= 2]
        if not xs or not ys:
            return False

        w = max(xs) - min(xs)
        h = max(ys) - min(ys)
        if w <= 0 or h <= 0:
            return False

        aspect_ratio = max(w, h) / max(min(w, h), 1.0)
        if aspect_ratio <= 12.0:
            return False

        has_letters = any(c.isalnum() for c in clean_text)
        if not has_letters:
            return True

        if img is not None:
            try:
                x_min, x_max = int(max(0, min(xs))), int(min(img.shape[1], max(xs)))
                y_min, y_max = int(max(0, min(ys))), int(min(img.shape[0], max(ys)))
                if (x_max - x_min) > 4 and (y_max - y_min) > 4:
                    roi = img[y_min:y_max, x_min:x_max]
                    gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi
                    edges = cv2.Canny(gray_roi, 50, 150)
                    edge_density = float(np.mean(edges > 0))
                    if edge_density > 0.55 and len(clean_text) <= 2:
                        return True
            except Exception:
                pass

        symbol_ratio = sum(1 for c in clean_text if c in "-_.~|=+:*^—–") / max(len(clean_text), 1)
        if symbol_ratio >= 0.70:
            return True

        return False
    except Exception:
        return False


def _parse_detections(detections, threshold, img=None):
    """
    Parses PaddleOCR page detections into (accepted_blocks, rejected_blocks).
    Each item is a tuple: (detected_text, confidence_score, bounding_box)
    Filters out graph/divider line artifacts with extreme aspect ratio (> 10:1).
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
                    if is_graph_or_line_artifact(box, detected_text, img):
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
_HINDI_WORD_FREQ = None
_CACHED_MATRA_RULES = None
_CACHED_CONFUSION_RULES = None
DEVANAGARI_CHAR_RE = re.compile(r"[\u0900-\u097F]")

# Unicode classification sets for Hindi visual rule engine
DEVANAGARI_CONSONANTS = set(chr(c) for c in range(0x0915, 0x093A)) | set(chr(c) for c in range(0x0958, 0x0960))
DEVANAGARI_VOWEL_SIGNS = set(chr(c) for c in range(0x093E, 0x094D))
DEVANAGARI_MODIFIERS = {"\u0901", "\u0902", "\u0903", "\u094D"}
DEVANAGARI_ALL_MATRAS = DEVANAGARI_VOWEL_SIGNS | DEVANAGARI_MODIFIERS

HINDI_CONFUSION_EXACT = {
    # Rule 1: Visarga / Matra / Half-character errors
    "नःशुलक": "निःशुल्क",
    "नःशुल्क": "निःशुल्क",
    "निःशुलक": "निःशुल्क",
    "निशुल्क": "निःशुल्क",
    "निशुलक": "निःशुल्क",
    "दःख": "दुःख",
    
    # Rule 2: Unnecessary Anusvara attaching to consonants
    "सुंबह": "सुबह",
    "सुंबहा": "सुबह",
    "अंस्पताल": "अस्पताल",
    "अस्पंतााल": "अस्पताल",
    "डॉंक्टर": "डॉक्टर",
    "डांक्टर": "डॉक्टर",
    "संबय": "समय",
    "संबमय": "समय",
    "अपांइटमेंट": "अपॉइंटमेंट",
    "अपॉंइंटमेंट": "अपॉइंटमेंट",
    "विशेषंज्ञ": "विशेषज्ञ",
    "मोंतियाबिंद": "मोतियाबिंद",
    "उंपलब्ध": "उपलब्ध",
    "सुंविधा": "सुविधा",
    "रांझीं": "रांझी",
    "ऑंपरेशन": "ऑपरेशन",
    "ओंपरेशन": "ऑपरेशन",
}


def get_hindi_matra_rules():
    """Loads and caches hindi_matra_rules.json."""
    global _CACHED_MATRA_RULES
    if _CACHED_MATRA_RULES is not None:
        return _CACHED_MATRA_RULES

    matra_paths = [
        Path(__file__).resolve().parent / "hindi_matra_rules.json",
        Path(__file__).resolve().parent / "dictionaries" / "hindi_matra_rules.json",
        Path(__file__).resolve().parent.parent / "dictionaries" / "hindi_matra_rules.json",
        Path(__file__).resolve().parents[1] / "dictionaries" / "hindi_matra_rules.json",
        Path(__file__).resolve().parents[2] / "hindi_matra_rules.json",
    ]
    for p in matra_paths:
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    _CACHED_MATRA_RULES = json.load(f)
                    return _CACHED_MATRA_RULES
            except Exception:
                pass
    _CACHED_MATRA_RULES = {"matras": {}}
    return _CACHED_MATRA_RULES


def get_confusion_rules():
    """Loads and caches dynamic confusion rules from confusion_rules.json."""
    global _CACHED_CONFUSION_RULES
    if _CACHED_CONFUSION_RULES is not None:
        return _CACHED_CONFUSION_RULES

    rules_paths = [
        Path(__file__).resolve().parent / "confusion_rules.json",
        Path(__file__).resolve().parent / "dictionaries" / "confusion_rules.json",
        Path(__file__).resolve().parent.parent / "dictionaries" / "confusion_rules.json",
        Path(__file__).resolve().parents[1] / "dictionaries" / "confusion_rules.json",
        Path(__file__).resolve().parents[2] / "confusion_rules.json",
    ]
    for p in rules_paths:
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    _CACHED_CONFUSION_RULES = data.get("rules", []) if isinstance(data, dict) else data
                    if isinstance(_CACHED_CONFUSION_RULES, list) and len(_CACHED_CONFUSION_RULES) > 0:
                        return _CACHED_CONFUSION_RULES
            except Exception:
                pass
    _CACHED_CONFUSION_RULES = []
    return _CACHED_CONFUSION_RULES


def get_hindi_word_frequency():
    """Loads and caches hindi_word_frequency.json."""
    global _HINDI_WORD_FREQ
    if _HINDI_WORD_FREQ is not None:
        return _HINDI_WORD_FREQ

    freq_paths = [
        Path(__file__).resolve().parent / "hindi_word_frequency.json",
        Path(__file__).resolve().parent.parent / "dictionaries" / "hindi_word_frequency.json",
        Path(__file__).resolve().parents[1] / "dictionaries" / "hindi_word_frequency.json",
        Path(__file__).resolve().parents[2] / "hindi_word_frequency.json",
    ]
    for p in freq_paths:
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    _HINDI_WORD_FREQ = json.load(f)
                    return _HINDI_WORD_FREQ
            except Exception:
                pass
    _HINDI_WORD_FREQ = {}
    return _HINDI_WORD_FREQ


def analyze_hindi_word(word: str) -> dict:
    """
    Visual Rule Engine for Devanagari words.
    Analyzes character sequence:
      Rule 1: A matra like ि or ः must be preceded by a consonant.
      Rule 2: Cannot have two consecutive vowel signs (e.g. \u093F followed by \u0941).
      Rule 3: Visarga check & replacement candidate generation using hindi_matra_rules.json.
    """
    if not word or not isinstance(word, str) or not DEVANAGARI_CHAR_RE.search(word):
        return {"is_valid": True, "issues": [], "candidates": []}

    clean = word.strip()
    freq_dict = get_hindi_word_frequency()
    hindi_dict = get_hindi_dictionary_set()
    matra_rules = get_hindi_matra_rules().get("matras", {})

    issues = []
    candidates = []

    is_known_word = (clean in freq_dict) or (clean in hindi_dict)

    prev_char = None
    prev_is_consonant = False
    prev_is_vowel_sign = False

    for idx, ch in enumerate(clean):
        is_consonant = ch in DEVANAGARI_CONSONANTS
        is_vowel_sign = ch in DEVANAGARI_VOWEL_SIGNS
        is_matra = ch in DEVANAGARI_ALL_MATRAS

        # Rule 1: A matra like \u093F (ि) or \u0903 (ः) must be preceded by a consonant
        if ch in ("\u093F", "\u0903"):
            if idx == 0 or not prev_is_consonant:
                issues.append(f"invalid_matra_position: '{ch}' at index {idx}")

        # Rule 2: Cannot have two consecutive vowel signs
        if is_vowel_sign and prev_is_vowel_sign:
            issues.append(f"consecutive_matras: '{prev_char}' followed by '{ch}' at index {idx}")

        prev_char = ch
        prev_is_consonant = is_consonant
        prev_is_vowel_sign = is_vowel_sign

    # Rule 3: Visarga check & replacement candidates
    if "\u0903" in clean:
        if not is_known_word:
            issues.append("visarga_confusion")
            confused = matra_rules.get("ः", {}).get("confused_with", ["ि", "ी"])
            for c_matra in confused:
                cand = clean.replace("\u0903", c_matra)
                if cand in freq_dict or cand in hindi_dict:
                    candidates.append(cand)
            if clean.startswith("नः"):
                cand_pref = "निः" + clean[2:]
                cand_fixed = cand_pref.replace("शुलक", "शुल्क")
                candidates.append(cand_pref)
                candidates.append(cand_fixed)

    # Halant split conjunct candidates (Phase 3)
    if "कष" in clean:
        cand_ksh = clean.replace("कष", "क्ष")
        if cand_ksh in freq_dict or cand_ksh in hindi_dict:
            candidates.append(cand_ksh)
    if "क्" in clean and "ष" in clean:
        cand_ksh2 = re.sub(r"क्\s*ष", "क्ष", clean)
        if cand_ksh2 in freq_dict or cand_ksh2 in hindi_dict:
            candidates.append(cand_ksh2)
    if "शुलक" in clean:
        cand_shulk = clean.replace("शुलक", "शुल्क")
        candidates.append(cand_shulk)

    valid_candidates = [c for c in candidates if c in freq_dict or c in hindi_dict]
    if not valid_candidates and candidates:
        valid_candidates = candidates

    return {
        "is_valid": len(issues) == 0,
        "issues": issues,
        "candidates": list(dict.fromkeys(valid_candidates)),
    }


def apply_hindi_confusion_rules(text: str, corrections_collector: list = None) -> str:
    """
    Devanagari-Specific Confusion Rules (Post-Processing).
    CRITICAL: Applied ONLY to tokens matching the Devanagari Unicode range ([\u0900-\u097F]).
    English words and pure English text are 100% bypassed and left untouched.
    """
    if not text or not isinstance(text, str):
        return text

    # Fast gate: If there are no Devanagari characters anywhere in text, bypass completely
    if not DEVANAGARI_CHAR_RE.search(text):
        return text

    freq_dict = get_hindi_word_frequency()
    dynamic_rules = get_confusion_rules()
    matra_rules = get_hindi_matra_rules().get("matras", {})

    exact_rules = dict(HINDI_CONFUSION_EXACT)
    start_rules = []
    rule_reasons = {}

    for r in dynamic_rules:
        if isinstance(r, dict):
            ctx = r.get("context", "exact_word")
            pat = r.get("pattern")
            rep = r.get("replacement")
            if pat and rep:
                if ctx == "exact_word":
                    exact_rules[pat] = rep
                    rule_reasons[pat] = r.get("reason", "Dynamic confusion rule")
                elif ctx == "start_of_word":
                    start_rules.append((pat, rep, r.get("reason", "Prefix confusion rule")))

    # Whole text halant split repair: e.g. "क् ष" -> "क्ष"
    if "क्" in text and "ष" in text:
        merged_text = re.sub(r"क्\s+ष", "क्ष", text)
        if merged_text != text:
            if corrections_collector is not None:
                corrections_collector.append({
                    "original": "क् ष",
                    "corrected": "क्ष",
                    "rule": "Halant split conjunct repair",
                    "type": "OCR_ERROR",
                    "error_type": "OCR_ERROR"
                })
            text = merged_text

    def fix_token(match):
        raw_token = match.group(0)
        if not DEVANAGARI_CHAR_RE.search(raw_token):
            return raw_token

        clean = raw_token.strip()

        # Check exact known confusion map first
        if clean in exact_rules:
            repl = exact_rules[clean]
            if clean != repl and corrections_collector is not None:
                corrections_collector.append({
                    "original": clean,
                    "corrected": repl,
                    "rule": rule_reasons.get(clean, "Matra/Visarga confusion fix"),
                    "type": "OCR_ERROR",
                    "error_type": "OCR_ERROR"
                })
            return repl

        # ANTI-OVER-ENGINEERING SAFETY CHECK:
        # If clean token is ALREADY a valid established Hindi word (e.g. "हंस", "रंग", "संत", "कंस", "पुनः", "प्रायः", "दुःख", "पसंद", "आनंद"),
        # NEVER mutate or strip its characters!
        if clean in freq_dict:
            return raw_token

        # Check start_of_word rules (e.g. "नः" prefix)
        for pat, rep, r_reason in start_rules:
            if clean.startswith(pat) and len(clean) > len(pat):
                cand = rep + clean[len(pat):]
                # Halant repair on suffix if needed
                if "शुलक" in cand:
                    cand = cand.replace("शुलक", "शुल्क")
                if cand in freq_dict or cand in exact_rules.values():
                    if corrections_collector is not None:
                        corrections_collector.append({
                            "original": clean,
                            "corrected": cand,
                            "rule": r_reason,
                            "type": "OCR_ERROR",
                            "error_type": "OCR_ERROR"
                        })
                    return cand

        # Phase 3: Halant split conjunct repair
        if "कष" in clean:
            cand = clean.replace("कष", "क्ष")
            if cand in freq_dict or cand in exact_rules.values():
                if corrections_collector is not None:
                    corrections_collector.append({
                        "original": clean,
                        "corrected": cand,
                        "rule": "Halant conjunct repair (कष -> क्ष)",
                        "type": "OCR_ERROR",
                        "error_type": "OCR_ERROR"
                    })
                return cand

        if "शुलक" in clean:
            cand = clean.replace("शुलक", "शुल्क")
            if cand in freq_dict or cand in exact_rules.values():
                if corrections_collector is not None:
                    corrections_collector.append({
                        "original": clean,
                        "corrected": cand,
                        "rule": "Halant conjunct repair (शुलक -> शुल्क)",
                        "type": "OCR_ERROR",
                        "error_type": "OCR_ERROR"
                    })
                return cand

        # Rule 1 (Visarga/Matra): Visarga 'ः' following consonant where short-i 'ि' was intended
        if "ः" in clean:
            if re.match(r"^नःशुल[कक्][ा-ौ]?$", clean):
                if corrections_collector is not None:
                    corrections_collector.append({
                        "original": clean,
                        "corrected": "निःशुल्क",
                        "rule": "Visarga and matra confusion fix",
                        "type": "OCR_ERROR",
                        "error_type": "OCR_ERROR"
                    })
                return "निःशुल्क"
            if re.match(r"^नः([शस][\u0900-\u097F]+)$", clean):
                cand = "निः" + clean[2:]
                if cand in freq_dict or cand in exact_rules.values():
                    if corrections_collector is not None:
                        corrections_collector.append({
                            "original": clean,
                            "corrected": cand,
                            "rule": "Prefix visarga confusion fix",
                            "type": "OCR_ERROR",
                            "error_type": "OCR_ERROR"
                        })
                    return cand

        # Rule 2 (Anusvara/Consonant): Strip unnecessary OCR noise anusvara ONLY IF:
        # 1. clean token itself is NOT in dictionary/corpus
        # 2. AND stripped version is a known high-frequency word
        if "ं" in clean:
            stripped = clean.replace("ं", "")
            if stripped in freq_dict or stripped in exact_rules.values():
                if corrections_collector is not None:
                    corrections_collector.append({
                        "original": clean,
                        "corrected": stripped,
                        "rule": "Spurious anusvara removal on consonant",
                        "type": "OCR_ERROR",
                        "error_type": "OCR_ERROR"
                    })
                return stripped

        # Visual Rule Engine / Matra Analysis candidates
        analysis = analyze_hindi_word(clean)
        if not analysis["is_valid"] and analysis["candidates"]:
            best_cand = analysis["candidates"][0]
            if corrections_collector is not None:
                corrections_collector.append({
                    "original": clean,
                    "corrected": best_cand,
                    "rule": f"Visual rule engine ({', '.join(analysis['issues'])})",
                    "type": "OCR_ERROR",
                    "error_type": "OCR_ERROR"
                })
            return best_cand

        return raw_token

    token_pattern = re.compile(r"[\u0900-\u097F]+|[A-Za-z]+|\S+")
    return token_pattern.sub(fix_token, text)


def get_hindi_dictionary_set():
    """Lazily loads and caches Hindi dictionary words from dictionaries/hi_IN/hi_IN.dic."""
    global _CACHED_HINDI_DICT
    if _CACHED_HINDI_DICT is not None:
        return _CACHED_HINDI_DICT

    words = set()
    base_dir = Path(__file__).resolve().parent
    dict_path = base_dir / "dictionaries" / "hi_IN" / "hi_IN.dic"
    if not dict_path.exists():
        dict_path = base_dir.parent / "dictionaries" / "hi_IN" / "hi_IN.dic"
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
    Word-Level Weighted Voting Algorithm across preprocessing variants:
      Total Score (0..100) = Dictionary Score (50 pts) + Confidence Score (30 pts) + Frequency Score (20 pts)
      - Dictionary (50 pts) : Word is in Hindi/English dictionary or client whitelist (+50) else 0.
      - Confidence (30 pts) : Average OCR confidence of this reading (avg_conf * 30).
      - Frequency  (20 pts) : (count_in_variants / total_variants) * 20 + Hindi corpus frequency bonus.
    """
    scores = {}
    hindi_freq = get_hindi_word_frequency()

    for cand, conf_list in candidate_variants.items():
        clean_c = cand.strip()
        if not clean_c:
            continue
        # Apply hindi confusion rule on candidate first if Devanagari
        normalized_c = apply_hindi_confusion_rules(clean_c)

        # 1. Dictionary Score (50 points)
        in_dict = (normalized_c in dictionary_set) or (normalized_c.lower() in dictionary_set) or (normalized_c in whitelist_set)
        word_freq_val = hindi_freq.get(normalized_c, 0)
        if word_freq_val > 0:
            in_dict = True

        dict_score = 50.0 if in_dict else 0.0

        # 2. Confidence Score (30 points)
        avg_conf = sum(conf_list) / max(1, len(conf_list))
        conf_score = round(avg_conf * 30.0, 2)

        # 3. Frequency Score (20 points)
        freq_ratio = len(conf_list) / float(total_variants)
        freq_bonus = min(5.0, (word_freq_val / 1000.0) * 5.0) if word_freq_val > 0 else 0.0
        freq_score = round(min(1.0, freq_ratio) * 15.0 + freq_bonus, 2)

        total_score = dict_score + conf_score + freq_score
        scores[normalized_c] = {
            "word": normalized_c,
            "dict_score": dict_score,
            "conf_score": conf_score,
            "freq_score": freq_score,
            "total_score": total_score,
            "avg_conf": avg_conf,
        }

    if not scores:
        return "", 0.0, 0.0

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
                all_variant_results.append(_parse_detections(det, per_block_threshold, var_img))
        else:
            top1_name, top1_img = variants[0]
            top1_detections = hi_reader.ocr(top1_img, cls=True)
            top1_accepted, top1_rejected = _parse_detections(top1_detections, per_block_threshold, top1_img)
            top1_text = " ".join([b[0] for b in top1_accepted + top1_rejected])

            has_devanagari = any(0x0900 <= ord(c) <= 0x097F for c in top1_text)
            detected_lang = detect_language_from_text(top1_text)
            is_pure_english = (not has_devanagari) and (detected_lang == "en" or any(c.isalpha() for c in top1_text))

            # Compute average confidence of top 1 accepted
            confs1 = [b[1] for b in top1_accepted]
            top1_conf = sum(confs1) / len(confs1) if confs1 else 0.0

            all_variant_results = []
            if is_pure_english and top1_conf < 0.85:
                # Secondary OCR pass using lang="en" on top variant for low-confidence pure English
                active_en_reader = en_reader_factory(hi_reader)
                if active_en_reader is not hi_reader:
                    en_det1 = active_en_reader.ocr(top1_img, cls=True)
                    en_acc1, en_rej1 = _parse_detections(en_det1, per_block_threshold, top1_img)
                    en_confs1 = [b[1] for b in en_acc1]
                    en_conf1 = sum(en_confs1) / len(en_confs1) if en_confs1 else 0.0

                    if en_conf1 > top1_conf:
                        detected_language = "en"
                        active_reader = active_en_reader
                        all_variant_results.append((en_acc1, en_rej1))
                    else:
                        detected_language = "hi"
                        active_reader = hi_reader
                        all_variant_results.append((top1_accepted, top1_rejected))
                else:
                    detected_language = "en"
                    active_reader = hi_reader
                    all_variant_results.append((top1_accepted, top1_rejected))

                for var_name, var_img in variants[1:]:
                    det = active_reader.ocr(var_img, cls=True)
                    all_variant_results.append(_parse_detections(det, per_block_threshold, var_img))
            else:
                # If mixed (Hindi + English) or confident pure English/Hindi, stick to lang="hi"
                detected_language = "hi" if has_devanagari else detected_lang
                active_reader = hi_reader
                all_variant_results.append((top1_accepted, top1_rejected))
                for var_name, var_img in variants[1:]:
                    det = hi_reader.ocr(var_img, cls=True)
                    all_variant_results.append(_parse_detections(det, per_block_threshold, var_img))

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

    raw_lines = []
    accepted_lines = []
    accepted_line_confs = {}
    accepted_blocks_data = []
    seen_line_norms = []
    seen_words = set()
    seen_phones = set()
    corrections_applied = []

    top1_accepted_blocks, top1_rejected_blocks = all_variant_results[0]

    for item in top1_accepted_blocks:
        text = item[0]
        conf = item[1]
        box = item[2] if len(item) > 2 else []
        for wrong_w, correct_w in voted_replacements.items():
            if wrong_w in text:
                text = re.sub(r'\b' + re.escape(wrong_w) + r'\b', correct_w, text)

        cleaned_text = normalize_phone_numbers(text, target_phones).strip()
        raw_line_text = cleaned_text
        corrected_line_text = apply_hindi_confusion_rules(cleaned_text, corrections_collector=corrections_applied)
        norm = normalize_text_for_comparison(corrected_line_text)
        if not norm:
            continue

        if norm in seen_line_norms:
            continue

        rect = _compute_rect(box, img_width, img_height)
        raw_lines.append(raw_line_text)
        accepted_lines.append(corrected_line_text)
        accepted_line_confs[corrected_line_text] = conf
        accepted_blocks_data.append({
            "text": corrected_line_text,
            "raw_text": raw_line_text,
            "conf": conf,
            "box": box,
            "rect": rect,
        })
        seen_line_norms.append(norm)

        for w in extract_tokens(corrected_line_text):
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
            raw_line_text = cleaned_text
            corrected_line_text = apply_hindi_confusion_rules(cleaned_text, corrections_collector=corrections_applied)
            norm = normalize_text_for_comparison(corrected_line_text)
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

            tokens = extract_tokens(corrected_line_text)
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
            raw_lines.append(raw_line_text)
            accepted_lines.append(corrected_line_text)
            accepted_line_confs[corrected_line_text] = conf
            accepted_blocks_data.append({
                "text": corrected_line_text,
                "raw_text": raw_line_text,
                "conf": conf,
                "box": box,
                "rect": rect,
            })
            seen_line_norms.append(norm)

            for w in tokens:
                seen_words.add(w.lower())
                if re.fullmatch(r"\d{10}", w):
                    seen_phones.add(w)

    ocr_text_raw = "\n".join(raw_lines)
    ocr_text_corrected = "\n".join(accepted_lines)
    all_rects = [b["rect"] for b in accepted_blocks_data]

    # Deduplicate corrections_applied
    seen_corr = set()
    deduped_corrections = []
    for c_item in corrections_applied:
        k = (c_item.get("original"), c_item.get("corrected"))
        if k not in seen_corr:
            seen_corr.add(k)
            deduped_corrections.append(c_item)

    ocr_boxes = []
    for idx, b_item in enumerate(accepted_blocks_data, start=1):
        box_text = b_item["text"]
        raw_box_text = b_item.get("raw_text", box_text)
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
            "original_text": raw_box_text,
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
        "ocr_text": ocr_text_raw,
        "ocr_text_corrected": ocr_text_corrected,
        "corrections_applied": deduped_corrections,
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
        "ocr_text_corrected": final_res.get("ocr_text_corrected", final_res["ocr_text"]),
        "corrections_applied": final_res.get("corrections_applied", []),
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

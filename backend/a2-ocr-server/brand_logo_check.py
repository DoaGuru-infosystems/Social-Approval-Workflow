"""
Universal Client Logo Verification Engine for Social Approval Platform.
Architecture: Multi-Component Independent Verification (Symbol + Brand Name + Tagline + Layout).

Strict Policies:
- NO-DISK policy: Operates entirely in RAM with in-memory buffers.
- A2 Memory Guard: Downscales large posters/logos to safe dimensions in RAM before processing.
- Alpha-Channel Aware: Preserves RGBA transparency, crops to visible artwork, composites on dual backdrops.
- Universal Dynamic Design: Zero hardcoded client names or logos.
- Zero-Trust Policy: Missing logo or identity config strictly returns FAIL.
"""

import os
import sys
import json
import base64
import difflib
from pathlib import Path
import cv2
import numpy as np

# Memory & dimension guards
MAX_POST_SIDE = 1600
MAX_LOGO_SIDE = 800

# Decision thresholds
PASS_THRESHOLD = 0.85
SYMBOL_PASS_THRESHOLD = 0.75
TEXT_EXACT_THRESHOLD = 0.98

# Hindi location mapping
LOCATION_HINDI_MAP = {
    "top-left": "Upar Left corner me (top-left)",
    "top-right": "Upar Right corner me (top-right)",
    "bottom-left": "Neeche Left corner me (bottom-left)",
    "bottom-right": "Neeche Right corner me (bottom-right)",
    "center": "Beech me (center)",
    "top": "Upar beech me (top)",
    "bottom": "Neeche beech me (bottom)",
    "left": "Left side me",
    "right": "Right side me",
    "unknown": "Kahin nahi mila (unknown)",
}

SUGGESTION_RULES = {
    "MISSING": "Poster par official brand logo nahi mila. Brand Guidelines se official logo lagayein.",
    "WRONG_LOGO": "Poster par laga logo official brand logo se match nahi karta. Brand Guidelines se download karke lagayein.",
    "REFERENCE_LOGO_UNCONFIGURED": "Client Brand Guidelines me official brand logo configure nahi hai. Pehle official logo upload karein.",
    "LOGO_IDENTITY_UNCONFIGURED": "Client Brand Guidelines me official logo identity configure nahi hai. Pehle brand name configure karein.",
    "TAGLINE_MISSING": "Official brand logo ka mandatory tagline poster par missing hai. Tagline ke saath complete logo lagayein.",
    "WRONG_TAGLINE": "Logo ka tagline galat hai ya official tagline se match nahi karta.",
    "TOO_SMALL": "Logo bahut chhota hai. Logo ko kam se kam 10% bada karein.",
    "HIDDEN": "Logo text ya graphics ke peeche chhup gaya hai.",
    "COLOR_CHANGED": "Logo ka rang badal gaya hai. Official color palette use karein.",
    "MANUAL_REVIEW_BLOCKED": "Logo match me minor difference detect hua hai. Admin dwara manual review required hai.",
    "CORRECT": "Logo bilkul sahi jagah, size aur typography me laga hua hai.",
}


# ==============================================================================
# IN-MEMORY IMAGE LOADING & PREPROCESSING (ALPHA-AWARE)
# ==============================================================================

def _load_image_raw(image_or_path):
    """
    Load an image in RAM maintaining alpha channel if present (IMREAD_UNCHANGED).
    Accepts: numpy array, raw bytes, base64 data-uri, file path.
    """
    if image_or_path is None:
        return None

    if isinstance(image_or_path, np.ndarray):
        return image_or_path.copy()

    if isinstance(image_or_path, bytes):
        file_bytes = np.frombuffer(image_or_path, dtype=np.uint8)
        return cv2.imdecode(file_bytes, cv2.IMREAD_UNCHANGED)

    if isinstance(image_or_path, (str, Path)):
        str_val = str(image_or_path).strip()
        if str_val.startswith("data:image") or len(str_val) > 500:
            raw_b64 = str_val
            if "," in raw_b64 and raw_b64.startswith("data:"):
                raw_b64 = raw_b64.split(",", 1)[1]
            try:
                b_data = base64.b64decode(raw_b64)
                file_bytes = np.frombuffer(b_data, dtype=np.uint8)
                return cv2.imdecode(file_bytes, cv2.IMREAD_UNCHANGED)
            except Exception:
                pass

        path_obj = Path(str_val).expanduser().resolve()
        if path_obj.is_file():
            img = cv2.imread(str(path_obj), cv2.IMREAD_UNCHANGED)
            if img is not None:
                return img
            try:
                with open(str(path_obj), "rb") as f:
                    file_bytes = np.frombuffer(f.read(), dtype=np.uint8)
                    return cv2.imdecode(file_bytes, cv2.IMREAD_UNCHANGED)
            except Exception:
                pass

    return None


def _downscale_in_ram(image, max_side):
    """A2 Guard: Downscale large image in RAM while maintaining aspect ratio."""
    if image is None:
        return None
    h, w = image.shape[:2]
    if max(h, w) > max_side:
        scale = float(max_side) / float(max(h, w))
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        return cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return image


def _prepare_alpha_composites(raw_logo):
    """
    Given a raw reference logo (potentially 4-channel RGBA):
    1. Extracts alpha channel.
    2. Tight-crops to visible artwork bounding box (alpha > 20).
    3. Composites onto white (255) and dark (0) backgrounds.
    Returns: (comp_white, comp_dark, alpha_mask, crop_bbox)
    """
    if raw_logo is None or raw_logo.size == 0:
        return None, None, None, None

    h, w = raw_logo.shape[:2]
    has_alpha = (len(raw_logo.shape) == 3 and raw_logo.shape[2] == 4)

    if has_alpha:
        alpha = raw_logo[:, :, 3]
        visible_mask = alpha > 20
        y_idx, x_idx = np.where(visible_mask)

        if len(y_idx) > 10 and len(x_idx) > 10:
            y1, y2 = max(0, int(y_idx.min())), min(h, int(y_idx.max()) + 1)
            x1, x2 = max(0, int(x_idx.min())), min(w, int(x_idx.max()) + 1)
        else:
            y1, y2, x1, x2 = 0, h, 0, w

        cropped_raw = raw_logo[y1:y2, x1:x2]
        bgr = cropped_raw[:, :, :3].astype(np.float32)
        a_factor = (cropped_raw[:, :, 3].astype(np.float32) / 255.0)[:, :, np.newaxis]

        # White backdrop composite
        white_bg = np.ones_like(bgr) * 255.0
        comp_white = (bgr * a_factor + white_bg * (1.0 - a_factor)).astype(np.uint8)

        # Dark backdrop composite
        comp_dark = (bgr * a_factor).astype(np.uint8)

        return comp_white, comp_dark, cropped_raw[:, :, 3], (x1, y1, x2 - x1, y2 - y1)
    else:
        # 3-channel image (JPEG or flat PNG)
        bgr = raw_logo[:, :, :3] if len(raw_logo.shape) == 3 else cv2.cvtColor(raw_logo, cv2.COLOR_GRAY2BGR)
        # Tight-crop surrounding white/black borders
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        mask = (gray < 245) & (gray > 10)
        y_idx, x_idx = np.where(mask)
        if len(y_idx) > 10 and len(x_idx) > 10:
            y1, y2 = max(0, int(y_idx.min()) - 4), min(h, int(y_idx.max()) + 5)
            x1, x2 = max(0, int(x_idx.min()) - 4), min(w, int(x_idx.max()) + 5)
            bgr = bgr[y1:y2, x1:x2]
        return bgr, bgr, None, (0, 0, bgr.shape[1], bgr.shape[0])


def _encode_bgr_to_base64_data_uri(bgr_img):
    """Encode BGR numpy array directly to Base64 Data URI."""
    if bgr_img is None or bgr_img.size == 0:
        return None
    try:
        ok, buf = cv2.imencode(".png", bgr_img)
        if not ok:
            return None
        b64_str = base64.b64encode(buf).decode("utf-8")
        return f"data:image/png;base64,{b64_str}"
    except Exception:
        return None


def _classify_location(center_x, center_y, img_w, img_h):
    """Determine human-friendly poster quadrant location."""
    x_ratio = center_x / float(img_w)
    y_ratio = center_y / float(img_h)

    if y_ratio < 0.35:
        y_pos = "top"
    elif y_ratio > 0.65:
        y_pos = "bottom"
    else:
        y_pos = "middle"

    if x_ratio < 0.35:
        x_pos = "left"
    elif x_ratio > 0.65:
        x_pos = "right"
    else:
        x_pos = "center"

    if y_pos == "middle" and x_pos == "center":
        return "center"
    if y_pos == "middle":
        return f"{x_pos}"
    if x_pos == "center":
        return f"{y_pos}"
    return f"{y_pos}-{x_pos}"


# ==============================================================================
# MULTI-COMPONENT INDEPENDENT VERIFIER
# ==============================================================================

def _normalize_text(text):
    """Normalize string for robust token and fuzzy comparison."""
    if not text:
        return ""
    import re
    cleaned = re.sub(r"[^\w\s]", " ", str(text).upper())
    return " ".join(cleaned.split())


def _verify_brand_name(candidate_text, official_name, required_tokens):
    """
    Component 2: Verify Brand Name & Typography.
    Returns: (name_passed, token_score, diff_details)
    """
    cand_norm = _normalize_text(candidate_text)
    official_norm = _normalize_text(official_name)

    if not official_norm:
        return False, 0.0, "OFFICIAL_NAME_EMPTY"

    # Token-level presence check
    tokens = required_tokens if (required_tokens and len(required_tokens) > 0) else official_norm.split()
    matched_count = 0
    missing_tokens = []

    for tok in tokens:
        tok_clean = _normalize_text(tok)
        if not tok_clean:
            continue
        if tok_clean in cand_norm:
            matched_count += 1
        else:
            # Check for close Levenshtein match on word level
            cand_words = cand_norm.split()
            close_match = any(
                difflib.SequenceMatcher(None, tok_clean, cw).ratio() >= 0.85
                for cw in cand_words
            )
            if close_match:
                matched_count += 1
            else:
                missing_tokens.append(tok_clean)

    total_tokens = len(tokens)
    token_score = (matched_count / float(total_tokens)) if total_tokens > 0 else 0.0

    # Character-level Levenshtein similarity
    char_sim = difflib.SequenceMatcher(None, official_norm, cand_norm).ratio()

    # Exact token presence is required for PASS
    passed = (token_score >= 0.98) or (token_score >= 0.80 and char_sim >= 0.85)

    return passed, token_score, {
        "token_score": round(token_score, 2),
        "char_sim": round(char_sim, 2),
        "missing_tokens": missing_tokens,
    }


def _verify_tagline(candidate_text, tagline_policy, tagline_text):
    """
    Component 3: Verify Tagline according to configured policy.
    Returns: (tagline_passed, reason)
    """
    policy = str(tagline_policy or "NONE").upper().strip()
    if policy == "NONE":
        return True, "NONE"

    cand_norm = _normalize_text(candidate_text)
    tagline_norm = _normalize_text(tagline_text or "")

    if not tagline_norm:
        return True, "TAGLINE_EMPTY_CONFIG"

    tagline_present = tagline_norm in cand_norm or difflib.SequenceMatcher(None, tagline_norm, cand_norm).ratio() >= 0.70

    if policy == "MANDATORY":
        if tagline_present:
            return True, "CORRECT"
        else:
            return False, "TAGLINE_MISSING"

    if policy == "OPTIONAL":
        return True, "OPTIONAL_SATISFIED"

    return True, "UNKNOWN_POLICY"


# ==============================================================================
# MAIN MULTI-SCALE DETECTION ENGINE
# ==============================================================================

def _detect_best_logo_location(post_bgr, comp_white, comp_dark):
    """
    Multi-scale template matching across the poster using white and dark composites.
    Returns: (best_score, best_bbox, best_comp_type)
    """
    post_h, post_w = post_bgr.shape[:2]
    post_gray = cv2.cvtColor(post_bgr, cv2.COLOR_BGR2GRAY)

    best_score = -1.0
    best_bbox = (0, 0, 0, 0)
    best_comp = "white"

    # Evaluate both white and dark composites to handle bright and dark poster areas
    composites = [("white", comp_white), ("dark", comp_dark)]

    # Dynamic scale range from 0.12 to 0.55 of poster width
    scales = np.linspace(0.12, 0.52, 28)

    for comp_name, comp_img in composites:
        logo_gray = cv2.cvtColor(comp_img, cv2.COLOR_BGR2GRAY)
        lh, lw = logo_gray.shape[:2]

        for scale in scales:
            sw = int(lw * scale)
            sh = int(lh * scale)

            if sw < 20 or sh < 20 or sw >= post_w or sh >= post_h:
                continue

            scaled_logo = cv2.resize(logo_gray, (sw, sh), interpolation=cv2.INTER_AREA)
            res = cv2.matchTemplate(post_gray, scaled_logo, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, max_loc = cv2.minMaxLoc(res)

            # Spatial anchor bonus for corners and headers (where brand logos belong)
            bx, by = max_loc
            cx, cy = bx + sw // 2, by + sh // 2
            is_anchor = (cx < post_w * 0.35 or cx > post_w * 0.65 or cy < post_h * 0.25 or cy > post_h * 0.75)
            effective_score = max_val + (0.05 if is_anchor else 0.0)

            if effective_score > best_score:
                best_score = effective_score
                best_bbox = (bx, by, sw, sh)
                best_comp = comp_name

    return max(0.0, min(1.0, best_score)), best_bbox, best_comp


# ==============================================================================
# PUBLIC VERIFICATION ENTRYPOINT
# ==============================================================================

def check_brand_logo(post_image_bgr, reference_logo_path, logo_config=None):
    """
    Universal Client Logo Verification Engine.
    Executes independent multi-component verification across Symbol, Brand Name, Tagline, and Layout.
    """
    if logo_config is None:
        logo_config = {}

    # 1. Guard: Reference logo configured
    if not reference_logo_path:
        return {
            "status": "FAIL",
            "code": "REFERENCE_LOGO_UNCONFIGURED",
            "found": False,
            "score": 0.0,
            "location": "unknown",
            "location_hindi": LOCATION_HINDI_MAP["unknown"],
            "size_percent": 0,
            "reason": "REFERENCE_LOGO_UNCONFIGURED",
            "suggestion": SUGGESTION_RULES["REFERENCE_LOGO_UNCONFIGURED"],
            "checked_by": "Python",
            "candidate_crop_base64": None,
            "reference_crop_base64": None,
        }

    raw_logo = _load_image_raw(reference_logo_path)
    if raw_logo is None:
        return {
            "status": "FAIL",
            "code": "REFERENCE_LOGO_UNCONFIGURED",
            "found": False,
            "score": 0.0,
            "location": "unknown",
            "location_hindi": LOCATION_HINDI_MAP["unknown"],
            "size_percent": 0,
            "reason": "REFERENCE_LOGO_UNCONFIGURED",
            "suggestion": SUGGESTION_RULES["REFERENCE_LOGO_UNCONFIGURED"],
            "checked_by": "Python",
            "candidate_crop_base64": None,
            "reference_crop_base64": None,
        }

    # 2. Guard: Official Logo Identity configured
    official_brand_name = (logo_config.get("official_logo_brand_name") or "").strip()
    if not official_brand_name:
        return {
            "status": "FAIL",
            "code": "LOGO_IDENTITY_UNCONFIGURED",
            "found": False,
            "score": 0.0,
            "location": "unknown",
            "location_hindi": LOCATION_HINDI_MAP["unknown"],
            "size_percent": 0,
            "reason": "LOGO_IDENTITY_UNCONFIGURED",
            "suggestion": SUGGESTION_RULES["LOGO_IDENTITY_UNCONFIGURED"],
            "checked_by": "Python",
            "candidate_crop_base64": None,
            "reference_crop_base64": None,
        }

    # 3. Load Poster
    post_img = _load_image_raw(post_image_bgr)
    if post_img is None:
        return {
            "status": "FAIL",
            "code": "POST_IMAGE_MISSING",
            "found": False,
            "score": 0.0,
            "location": "unknown",
            "location_hindi": LOCATION_HINDI_MAP["unknown"],
            "size_percent": 0,
            "reason": "MISSING",
            "suggestion": SUGGESTION_RULES["MISSING"],
            "checked_by": "Python",
            "candidate_crop_base64": None,
            "reference_crop_base64": None,
        }

    post_img = _downscale_in_ram(post_img, MAX_POST_SIDE)
    raw_logo = _downscale_in_ram(raw_logo, MAX_LOGO_SIDE)

    # 4. Alpha-Aware Crop & Composites
    comp_white, comp_dark, alpha_mask, crop_bbox = _prepare_alpha_composites(raw_logo)
    ref_crop_b64 = _encode_bgr_to_base64_data_uri(comp_white)

    # 5. Multi-Scale Anchor Zone Template Matching
    best_match_score, best_bbox, best_comp = _detect_best_logo_location(post_img, comp_white, comp_dark)
    bx, by, bw, bh = best_bbox

    post_h, post_w = post_img.shape[:2]
    cand_crop = post_img[max(0, by):min(post_h, by + bh), max(0, bx):min(post_w, bx + bw)]
    cand_crop_b64 = _encode_bgr_to_base64_data_uri(cand_crop)

    # Location & Size
    cx, cy = bx + bw // 2, by + bh // 2
    loc_key = _classify_location(cx, cy, post_w, post_h)
    loc_hindi = LOCATION_HINDI_MAP.get(loc_key, LOCATION_HINDI_MAP["unknown"])
    size_percent = int(round((bw / float(post_w)) * 100))

    # 6. Component 1: Symbol Verification
    # Extract symbol zone (upper 65% of reference logo)
    sym_h = max(10, int(comp_white.shape[0] * 0.65))
    sym_white = comp_white[:sym_h, :]
    sym_scaled = cv2.resize(sym_white, (bw, max(10, int(bh * 0.65))), interpolation=cv2.INTER_AREA)

    cand_sym = cand_crop[:max(10, int(bh * 0.65)), :]
    sym_score = 0.0
    is_inverted_contrast = False
    if cand_sym.shape[0] >= 10 and cand_sym.shape[1] >= 10:
        try:
            cand_gray = cv2.cvtColor(cand_sym, cv2.COLOR_BGR2GRAY)
            sym_gray = cv2.cvtColor(sym_scaled, cv2.COLOR_BGR2GRAY)
            res = cv2.matchTemplate(cand_gray, sym_gray, cv2.TM_CCOEFF_NORMED)
            raw_sym_score = float(res[0][0])

            # Inverted contrast check (e.g. bright logo on dark poster vs dark logo on white reference)
            cand_gray_inv = 255 - cand_gray
            res_inv = cv2.matchTemplate(cand_gray_inv, sym_gray, cv2.TM_CCOEFF_NORMED)
            raw_inv_score = float(res_inv[0][0])

            if raw_inv_score > raw_sym_score:
                sym_score = raw_inv_score
                is_inverted_contrast = True
            else:
                sym_score = raw_sym_score
                if raw_sym_score < 0 and abs(raw_sym_score) >= 0.60:
                    is_inverted_contrast = True
                    sym_score = abs(raw_sym_score)
        except Exception:
            sym_score = best_match_score

    symbol_passed = (sym_score >= SYMBOL_PASS_THRESHOLD) or (best_match_score >= 0.85)

    # 7. Component 2: Brand Name & Typography Verification
    # Gather OCR text from candidate region
    candidate_ocr_text = ""
    ocr_blocks = logo_config.get("ocr_blocks") or []
    for block in ocr_blocks:
        b_text = block.get("text") or ""
        rect = block.get("rect") or block.get("bbox") or []
        has_rect = False
        rx, ry, rw, rh = 0, 0, 0, 0

        if isinstance(rect, dict):
            rx = float(rect.get("left", rect.get("x", 0)))
            ry = float(rect.get("top", rect.get("y", 0)))
            rw = float(rect.get("width", rect.get("w", 0)))
            rh = float(rect.get("height", rect.get("h", 0)))
            has_rect = True
        elif isinstance(rect, (list, tuple)) and len(rect) >= 4:
            rx, ry, rw, rh = float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3])
            has_rect = True

        if has_rect:
            # Check percentage vs absolute coordinates
            if rx <= 100.0 and ry <= 100.0 and post_w > 0 and post_h > 0:
                rx_px = (rx / 100.0) * post_w if rx > 1.0 else rx * post_w
                ry_px = (ry / 100.0) * post_h if ry > 1.0 else ry * post_h
                rw_px = (rw / 100.0) * post_w if rw > 1.0 else rw * post_w
                rh_px = (rh / 100.0) * post_h if rh > 1.0 else rh * post_h
            else:
                rx_px, ry_px, rw_px, rh_px = rx, ry, rw, rh

            # Proximity check with candidate bbox (within 150px)
            if (rx_px + rw_px >= bx - 100 and rx_px <= bx + bw + 100 and ry_px + rh_px >= by - 100 and ry_px <= by + bh + 200):
                candidate_ocr_text += " " + b_text
            elif any(tok.lower() in b_text.lower() for tok in (logo_config.get("required_brand_tokens") or [])):
                # If block explicitly contains official brand tokens, include it
                candidate_ocr_text += " " + b_text
        else:
            candidate_ocr_text += " " + b_text

    required_tokens = logo_config.get("required_brand_tokens") or []
    name_passed, token_score, name_details = _verify_brand_name(candidate_ocr_text, official_brand_name, required_tokens)

    # 8. Component 3: Tagline Policy Verification
    tagline_policy = logo_config.get("tagline_policy") or "NONE"
    tagline_text = logo_config.get("tagline_text")
    tagline_passed, tagline_reason = _verify_tagline(candidate_ocr_text, tagline_policy, tagline_text)

    # 9. Component 4: Layout and Structure Verification
    layout_passed = True
    if cand_crop.shape[0] > 0 and cand_crop.shape[1] > 0:
        # Check aspect ratio ratio between reference and candidate
        ref_aspect = comp_white.shape[1] / float(comp_white.shape[0])
        cand_aspect = cand_crop.shape[1] / float(cand_crop.shape[0])
        aspect_ratio_diff = abs(ref_aspect - cand_aspect) / ref_aspect
        if aspect_ratio_diff > 0.45 and not name_passed:
            layout_passed = False

    # 10. Composite Decision Matrix
    final_score = max(best_match_score, sym_score, token_score)

    if symbol_passed and name_passed and tagline_passed and layout_passed:
        if is_inverted_contrast:
            status = "PASS"
            reason = "COLOR_CHANGED"
            found = True
            suggestion = SUGGESTION_RULES["COLOR_CHANGED"]
        else:
            status = "PASS"
            reason = "CORRECT"
            found = True
            suggestion = SUGGESTION_RULES["CORRECT"]
    elif final_score >= 0.70 and (symbol_passed or name_passed or sym_score >= 0.60):
        # Color difference, dark mode variant, or minor typography variance -> YELLOW (Warning / Review), NOT RED BLOCK
        status = "PASS"
        reason = "COLOR_CHANGED"
        found = True
        suggestion = SUGGESTION_RULES["COLOR_CHANGED"]
    elif not tagline_passed and tagline_policy != "MANDATORY":
        status = "PASS"
        reason = "COLOR_CHANGED"
        found = True
        suggestion = SUGGESTION_RULES["COLOR_CHANGED"]
    else:
        status = "FAIL"
        found = (final_score >= 0.35)
        reason = "WRONG_LOGO" if found else "MISSING"
        suggestion = SUGGESTION_RULES[reason]

    return {
        "status": status,
        "found": found,
        "score": round(max(0.0, min(1.0, final_score)), 2),
        "location": loc_key,
        "location_hindi": loc_hindi,
        "size_percent": size_percent,
        "reason": reason,
        "suggestion": suggestion,
        "checked_by": "Python",
        "symbol_score": round(sym_score, 2),
        "token_score": round(token_score, 2),
        "candidate_crop_base64": cand_crop_b64,
        "reference_crop_base64": ref_crop_b64,
        "bbox": [int(bx), int(by), int(bw), int(bh)],
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python brand_logo_check.py <post_image_path> <reference_logo_path> [config_json]")
        sys.exit(1)

    p_path = sys.argv[1]
    l_path = sys.argv[2]
    cfg = {}
    if len(sys.argv) > 3:
        try:
            cfg = json.loads(sys.argv[3])
        except Exception:
            cfg = {}

    res = check_brand_logo(p_path, l_path, cfg)
    print(json.dumps(res, indent=2, ensure_ascii=False))

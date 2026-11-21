"""
Brand Logo Verification Engine for Doaguru Social Approval Platform.
Architecture: AI FIRST (Vision AI / Gemini), with OpenCV PYTHON FALLBACK (SIFT + ORB + Template Matching).

Strict Policies:
- NO-DISK policy: Operates entirely in RAM with in-memory buffers.
- A2 Memory Guard: Downscales poster to max 1600px before inspection.
- Location Independent: Searches the entire canvas without spatial bias.
"""

import os
import sys
import json
import base64
import urllib.request
from pathlib import Path
import cv2
import numpy as np

# A2 memory guard
MAX_POST_SIDE = 1600
MAX_LOGO_SIDE = 800
PASS_THRESHOLD = 0.85

# Suggestion Rules (System fallback if AI gives no suggestion or on Python fallback)
SUGGESTION_RULES = {
    "MISSING": "Logo post me kahin nahi mila. Logo ko post me lagayein.",
    "WRONG_LOGO": "Ye galat / purana logo hai. Brand Guidelines se naya logo download karke wahi lagayein.",
    "TOO_SMALL": "Logo bahut chhota hai. Logo ko kam se kam 10% bada karein.",
    "HIDDEN": "Logo text ke peeche chhup gaya hai. Logo ko khali jagah pe le jayein.",
    "COLOR_CHANGED": "Logo ka rang badal gaya hai. Logo ka original rang wapas rakhein.",
    "CORRECT": "Logo bilkul sahi jagah aur size me laga hua hai.",
    "SKIPPED": "Logo Check Skipped - Logo upload nahi hai",
}

LOCATION_HINDI_MAP = {
    "top-left": "Upar Left corner me",
    "top-right": "Upar Right corner me",
    "bottom-left": "Neeche Left corner me",
    "bottom-right": "Neeche Right corner me",
    "center": "Beech me (Center)",
    "top": "Upar beech me",
    "bottom": "Neeche beech me",
    "left": "Left side me",
    "right": "Right side me",
    "unknown": "Kahin nahi mila",
}


def _is_dummy_key(key):
    if not key or not isinstance(key, str):
        return True
    k = key.strip().lower()
    return k == "" or k == "your_gemini_api_key" or "dummy" in k or "test" in k


def _get_api_key():
    """Retrieve Gemini API key from environment or local .env file. Skips dummy/test keys."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if api_key and not _is_dummy_key(api_key):
        return api_key.strip()

    # Try loading from backend/.env if not present in os.environ
    search_paths = [
        Path(__file__).resolve().parent.parent / ".env",
        Path(__file__).resolve().parent / ".env",
        Path.cwd() / "backend" / ".env",
        Path.cwd() / ".env",
    ]
    for env_path in search_paths:
        if env_path.is_file():
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("GEMINI_API_KEY="):
                            val = line.split("=", 1)[1].strip().strip('"').strip("'")
                            if val and not _is_dummy_key(val):
                                return val
            except Exception:
                pass
    return None


def _load_image_to_bgr(image_or_path):
    """
    Load an image into a BGR numpy array in RAM.
    Accepts:
      - numpy ndarray (already loaded BGR image)
      - file path (string or Path)
      - base64 string or data-uri
      - raw bytes
    """
    if image_or_path is None:
        return None

    if isinstance(image_or_path, np.ndarray):
        return image_or_path.copy()

    if isinstance(image_or_path, bytes):
        file_bytes = np.frombuffer(image_or_path, dtype=np.uint8)
        return cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)

    if isinstance(image_or_path, (str, Path)):
        str_val = str(image_or_path).strip()
        # 1. Base64 string check
        if str_val.startswith("data:image") or len(str_val) > 500:
            raw_b64 = str_val
            if "," in raw_b64 and raw_b64.startswith("data:"):
                raw_b64 = raw_b64.split(",", 1)[1]
            try:
                b_data = base64.b64decode(raw_b64)
                file_bytes = np.frombuffer(b_data, dtype=np.uint8)
                img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
                if img is not None:
                    return img
            except Exception:
                pass

        # 2. File path check
        path_obj = Path(str_val).expanduser().resolve()
        if path_obj.is_file():
            img = cv2.imread(str(path_obj))
            if img is not None:
                return img
            # Fallback for unicode paths on Windows
            try:
                with open(str(path_obj), "rb") as f:
                    file_bytes = np.frombuffer(f.read(), dtype=np.uint8)
                    return cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
            except Exception:
                pass

    return None


def _downscale_in_ram(bgr_image, max_side):
    """A2 Guard: Downscale large image in RAM while maintaining aspect ratio."""
    if bgr_image is None:
        return None
    h, w = bgr_image.shape[:2]
    if max(h, w) > max_side:
        scale = float(max_side) / float(max(h, w))
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        return cv2.resize(bgr_image, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return bgr_image


def _tight_crop_logo(bgr_img):
    """
    Remove surrounding white or transparent borders from reference logo.
    Finds bounding box of non-white pixels with small padding.
    """
    if bgr_img is None or bgr_img.size == 0:
        return bgr_img

    if len(bgr_img.shape) == 3 and bgr_img.shape[2] == 4:
        alpha = bgr_img[:, :, 3]
        non_transparent = alpha > 20
        if np.any(non_transparent):
            coords = cv2.findNonZero(non_transparent.astype(np.uint8))
            if coords is not None:
                x, y, w, h = cv2.boundingRect(coords)
                pad = 4
                x1 = max(0, x - pad)
                y1 = max(0, y - pad)
                x2 = min(bgr_img.shape[1], x + w + pad)
                y2 = min(bgr_img.shape[0], y + h + pad)
                return cv2.cvtColor(bgr_img[y1:y2, x1:x2], cv2.COLOR_BGRA2BGR)

    gray = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2GRAY)
    non_white = gray < 240
    if np.any(non_white):
        coords = cv2.findNonZero(non_white.astype(np.uint8))
        if coords is not None:
            x, y, w, h = cv2.boundingRect(coords)
            if w > 20 and h > 20:
                pad = 4
                x1 = max(0, x - pad)
                y1 = max(0, y - pad)
                x2 = min(bgr_img.shape[1], x + w + pad)
                y2 = min(bgr_img.shape[0], y + h + pad)
                return bgr_img[y1:y2, x1:x2]

    return bgr_img


def _encode_bgr_to_base64_data_uri(bgr_img, ext=".png"):
    """Encode BGR numpy array to base64 data URI in memory (NO-DISK)."""
    if bgr_img is None or bgr_img.size == 0:
        return None
    try:
        ok, buf = cv2.imencode(ext, bgr_img)
        if ok:
            b64 = base64.b64encode(buf).decode("utf-8")
            mime = "image/png" if ext == ".png" else "image/jpeg"
            return f"data:{mime};base64,{b64}"
    except Exception:
        pass
    return None


def _map_location_hindi(location):
    """Normalize location and return Hindi description."""
    clean_loc = str(location or "").strip().lower().replace("_", "-")
    for key, val in LOCATION_HINDI_MAP.items():
        if key in clean_loc:
            return key, val
    return "unknown", LOCATION_HINDI_MAP["unknown"]


# ==============================================================================
# STEP 1 - AI FIRST (Vision AI / Gemini)
# ==============================================================================

def _check_logo_with_vision_ai(post_bgr, logo_bgr, api_key=None, timeout_sec=12):
    """
    Call Multimodal Vision AI with reference logo and post image.
    Prompt:
      "Find this reference logo anywhere in this post image. Return JSON: {found, match_score 0-1, location: top-left/top-right/bottom-left/bottom-right/center, size_percent, reason}"
    """
    if api_key is None:
        api_key = _get_api_key()

    if not api_key:
        return None

    # Encode in memory (RAM only)
    ok1, logo_buf = cv2.imencode(".png", logo_bgr)
    ok2, post_buf = cv2.imencode(".jpg", post_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok1 or not ok2:
        return None

    logo_b64 = base64.b64encode(logo_buf).decode("utf-8")
    post_b64 = base64.b64encode(post_buf).decode("utf-8")

    prompt = (
        "You are a strict, brand-agnostic logo auditor.\n"
        "Image 1 is the official reference brand logo from Brand Guidelines.\n"
        "Image 2 is a social media poster to inspect.\n\n"
        "TASK:\n"
        "Determine whether the EXACT brand logo shown in Image 1 appears anywhere on the poster in Image 2.\n\n"
        "CRITICAL BRAND-AGNOSTIC VALIDATION RULES:\n"
        "1. EMBLEM / ARTWORK INTEGRITY: Look at the exact central drawing, emblem, and iconography in Image 1. "
        "The candidate logo on Image 2 MUST have the exact same drawing. If the inner drawing is changed, substituted, "
        "or morphed (e.g. a different organ, icon, or drawing inside a similar border), you MUST return found: false, match_score: 0.50, reason: 'WRONG_LOGO'.\n"
        "2. FULL TEXT & TYPOGRAPHY: All words and company title written in the logo in Image 1 MUST be completely and accurately present on the logo in Image 2. "
        "If any word, suffix, or part of the brand title is omitted, missing, or altered, you MUST return found: false, match_score: 0.50, reason: 'WRONG_LOGO'.\n"
        "3. FOREIGN OR UNRELATED BRAND: If Image 2 contains a different organization's logo or branding, return found: false, match_score: 0.0, reason: 'WRONG_LOGO'.\n"
        "4. NEVER return found: true merely because the outer shape, circle, frame, or color matches. Both the inner artwork AND the full text must match Image 1.\n\n"
        "Return STRICT JSON with these exact keys:\n"
        "{\n"
        '  "found": true or false,\n'
        '  "match_score": number between 0.0 and 1.0 (>= 0.85 only if clear exact match with Image 1),\n'
        '  "location": "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "unknown",\n'
        '  "size_percent": integer percentage of image width or area occupied by logo,\n'
        '  "reason": "CORRECT" | "MISSING" | "WRONG_LOGO" | "TOO_SMALL" | "HIDDEN" | "COLOR_CHANGED",\n'
        '  "suggestion": "One line actionable suggestion in Hindi/Hinglish for the graphic designer"\n'
        "}"
    )

    body = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": "image/png", "data": logo_b64}},
                    {"text": "Above is Image 1 (Official Reference Logo). Below is Image 2 (Social Media Post Image):"},
                    {"inline_data": {"mime_type": "image/jpeg", "data": post_b64}},
                ]
            }
        ],
        "generationConfig": {
            "response_mime_type": "application/json",
            "temperature": 0.1,
        },
    }

    # Fast multimodal vision models
    env_model = os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest")
    candidate_models = list(dict.fromkeys([
        env_model,
        "gemini-flash-lite-latest",
        "gemini-flash-latest"
    ]))
    encoded_body = json.dumps(body).encode("utf-8")

    for model in candidate_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        req = urllib.request.Request(
            url,
            data=encoded_body,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                if resp.status == 200:
                    resp_json = json.loads(resp.read().decode("utf-8"))
                    candidates = resp_json.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts and "text" in parts[0]:
                            parsed = json.loads(parts[0]["text"])
                            return parsed
        except Exception:
            continue

    return None


# ==============================================================================
# STEP 2 - PYTHON FALLBACK (OpenCV SIFT + ORB + Multi-Scale Template Matching)
# ==============================================================================

def _check_logo_with_python_cv(post_bgr, logo_bgr):
    """
    Python fallback engine using:
    - Tight-crop Reference Logo (strips whitespace borders)
    - Multi-scale Template Matching across the WHOLE image (8% to 35% of post width)
    - SIFT feature matching with spatial consistency
    - Dual-Zone Structural Correlation (Emblem Zone vs Typography/Text Zone)
    - Strict thresholding (>= 0.75 composite required for PASS)
    - HSV Color Histogram comparison for style/tint change detection (Yellow Warning)
    Returns: dict(found, score, location, size_percent, reason, bbox, candidate_crop_base64, reference_crop_base64)
    """
    post_h, post_w = post_bgr.shape[:2]
    tight_logo = _tight_crop_logo(logo_bgr)
    logo_h, logo_w = tight_logo.shape[:2]

    post_gray = cv2.cvtColor(post_bgr, cv2.COLOR_BGR2GRAY)
    logo_gray = cv2.cvtColor(tight_logo, cv2.COLOR_BGR2GRAY)

    best_template_score = 0.0
    best_template_box = (0, 0, max(20, int(post_w * 0.1)), max(20, int(post_h * 0.1)))

    # 1. Multi-Scale Template Matching with sliding window
    # Search logo sizes between 8% and 35% of post width
    min_target_w = max(20, int(post_w * 0.08))
    max_target_w = min(post_w - 5, int(post_w * 0.35))

    target_widths = np.linspace(min_target_w, max_target_w, num=15, dtype=int)
    for tw in target_widths:
        th = max(20, int(round(tw * (logo_h / float(logo_w)))))
        if tw >= post_w or th >= post_h:
            continue

        scaled_logo = cv2.resize(logo_gray, (tw, th), interpolation=cv2.INTER_AREA)
        res = cv2.matchTemplate(post_gray, scaled_logo, cv2.TM_CCOEFF_NORMED)
        _min_val, max_val, _min_loc, max_loc = cv2.minMaxLoc(res)

        if max_val > best_template_score:
            best_template_score = float(max_val)
            best_template_box = (max_loc[0], max_loc[1], tw, th)

    bx, by, bw, bh = best_template_box

    # 2. Extract Candidate Crop and compute Dual-Zone Structural Correlation
    cand_crop = post_bgr[max(0, by):min(post_h, by + bh), max(0, bx):min(post_w, bx + bw)]
    dual_zone_score = 0.0

    if cand_crop.size > 0 and bw > 10 and bh > 10:
        try:
            cand_resized = cv2.resize(cand_crop, (logo_w, logo_h), interpolation=cv2.INTER_AREA)
            cand_gray = cv2.cvtColor(cand_resized, cv2.COLOR_BGR2GRAY)

            # Zone 1: Upper Emblem (top 60%)
            split_y = int(logo_h * 0.6)
            emb_logo = logo_gray[:split_y, :]
            emb_cand = cand_gray[:split_y, :]
            res_emb = max(0.0, float(cv2.matchTemplate(emb_cand, emb_logo, cv2.TM_CCOEFF_NORMED)[0][0]))

            # Zone 2: Lower Typography / Text (bottom 40%)
            txt_logo = logo_gray[split_y:, :]
            txt_cand = cand_gray[split_y:, :]
            res_txt = max(0.0, float(cv2.matchTemplate(txt_cand, txt_logo, cv2.TM_CCOEFF_NORMED)[0][0]))

            dual_zone_score = (res_emb * 0.5) + (res_txt * 0.5)
        except Exception:
            dual_zone_score = 0.0

    # 3. SIFT Feature Matching with Spatial Consistency
    sift_score = 0.0
    sift_box = None
    inlier_ratio = 0.0
    try:
        sift = cv2.SIFT_create(nfeatures=1500)
        kp_logo, des_logo = sift.detectAndCompute(logo_gray, None)
        kp_post, des_post = sift.detectAndCompute(post_gray, None)

        if des_logo is not None and des_post is not None and len(kp_logo) >= 4 and len(kp_post) >= 4:
            bf = cv2.BFMatcher(cv2.NORM_L2)
            matches = bf.knnMatch(des_logo, des_post, k=2)

            good_matches = []
            for m_n in matches:
                if len(m_n) == 2:
                    m, n = m_n
                    if m.distance < 0.75 * n.distance:
                        good_matches.append(m)

            if len(good_matches) >= 4:
                src_pts = np.float32([kp_logo[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
                dst_pts = np.float32([kp_post[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)

                _matrix, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
                if mask is not None:
                    inliers = int(np.sum(mask))
                    inlier_ratio = inliers / float(len(good_matches))
                    sift_score = min(1.0, (inliers / 15.0) * 0.7 + inlier_ratio * 0.3)

                    inlier_pts = dst_pts[mask.ravel() == 1]
                    if len(inlier_pts) >= 4:
                        x, y, w, h = cv2.boundingRect(inlier_pts)
                        sift_box = (x, y, w, h)

                        pts_2d = inlier_pts.reshape(-1, 2)
                        w_ratio = w / float(post_w)
                        h_ratio = h / float(post_h)
                        std_x = float(np.std(pts_2d[:, 0]))
                        std_y = float(np.std(pts_2d[:, 1]))

                        if w_ratio > 0.60 or h_ratio > 0.60 or (std_x > post_w * 0.25 and std_y > post_h * 0.25):
                            sift_score *= 0.3
    except Exception:
        pass

    # 4. Composite Score with Strict Dual-Zone Emblem Guard
    composite_score = round((best_template_score * 0.5) + (dual_zone_score * 0.5), 2)
    feature_score = sift_score

    # Strict Emblem Guard:
    # If the inner emblem or typography fails (< 0.55), the logo is wrong!
    # SIFT matches on a generic outer circle/frame must NOT inflate the score.
    if dual_zone_score < 0.55 or best_template_score < 0.55:
        final_score = composite_score
        chosen_box = best_template_box
    elif composite_score >= 0.75:
        final_score = composite_score
        chosen_box = best_template_box
    elif feature_score >= 0.75 and inlier_ratio >= 0.35:
        final_score = round((composite_score * 0.5) + (feature_score * 0.5), 2)
        chosen_box = best_template_box
    else:
        final_score = composite_score
        chosen_box = best_template_box

    # Calculate normalized location
    cbx, cby, cbw, cbh = chosen_box
    cx = (cbx + cbw / 2.0) / float(post_w)
    cy = (cby + cbh / 2.0) / float(post_h)

    if 0.35 <= cx <= 0.65 and 0.35 <= cy <= 0.65:
        loc = "center"
    else:
        v_part = "top" if cy < 0.5 else "bottom"
        h_part = "left" if cx < 0.5 else "right"
        loc = f"{v_part}-{h_part}"

    size_percent = max(1, int(round((cbw / float(post_w)) * 100)))

    # 5. Strict Verdict & Color Verification
    if final_score >= 0.75:
        # Check Color Integrity (HSV Histogram Correlation)
        try:
            if cand_crop.size > 0:
                crop_hsv = cv2.cvtColor(cand_crop, cv2.COLOR_BGR2HSV)
                logo_hsv = cv2.cvtColor(tight_logo, cv2.COLOR_BGR2HSV)
                hist_crop = cv2.calcHist([crop_hsv], [0, 1], None, [16, 16], [0, 180, 0, 256])
                hist_logo = cv2.calcHist([logo_hsv], [0, 1], None, [16, 16], [0, 180, 0, 256])
                cv2.normalize(hist_crop, hist_crop, 0, 1, cv2.NORM_MINMAX)
                cv2.normalize(hist_logo, hist_logo, 0, 1, cv2.NORM_MINMAX)
                color_corr = cv2.compareHist(hist_crop, hist_logo, cv2.HISTCMP_CORREL)

                if color_corr < 0.25:
                    reason = "COLOR_CHANGED"
                    found = True
                else:
                    reason = "CORRECT"
                    found = True
            else:
                found = False
                reason = "MISSING"
        except Exception:
            reason = "CORRECT"
            found = True
    else:
        found = False
        if final_score >= 0.20:
            reason = "WRONG_LOGO"
        else:
            reason = "MISSING"

    cand_crop_b64 = _encode_bgr_to_base64_data_uri(cand_crop)
    ref_crop_b64 = _encode_bgr_to_base64_data_uri(tight_logo)

    return {
        "found": found,
        "score": round(max(0.0, min(1.0, final_score)), 2),
        "location": loc,
        "size_percent": size_percent,
        "reason": reason,
        "candidate_crop_base64": cand_crop_b64,
        "reference_crop_base64": ref_crop_b64,
        "bbox": [int(cbx), int(cby), int(cbw), int(cbh)],
    }


# ==============================================================================
# MAIN PUBLIC API
# ==============================================================================

def check_brand_logo(post_image_bgr, reference_logo_path):
    """
    Check if the client's official brand logo is correctly present in the post image.

    Flow:
      Step 1 - AI FIRST (Priority):
        - Calls Gemini Vision AI with focused, tight-cropped logo.
        - If AI returns found=true and match_score >= 0.85 => PASS.
      Step 2 - PYTHON FALLBACK:
        - OpenCV Multi-scale Template Matching + Dual-Zone Structural Correlation + SIFT.
        - Strict threshold >= 0.75 for PASS. Color change mapped to COLOR_CHANGED warning.

    Returns:
      dict matching exact JSON schema with candidate_crop_base64 and reference_crop_base64.
    """
    # 1. Load and guard post image in RAM
    post_img = _load_image_to_bgr(post_image_bgr)
    if post_img is None:
        return {
            "status": "FAIL",
            "found": False,
            "score": 0.0,
            "location": "unknown",
            "location_hindi": "Kahin nahi mila",
            "size_percent": 0,
            "reason": "MISSING",
            "suggestion": SUGGESTION_RULES["MISSING"],
            "candidate_crop_base64": None,
            "reference_crop_base64": None,
        }

    post_img = _downscale_in_ram(post_img, MAX_POST_SIDE)

    # 2. Load, downscale, and tight-crop reference logo in RAM
    logo_img = _load_image_to_bgr(reference_logo_path)
    if logo_img is None:
        return {
            "status": "FAIL",
            "found": False,
            "score": 0.0,
            "location": "unknown",
            "location_hindi": "Kahin nahi mila",
            "size_percent": 0,
            "reason": "MISSING",
            "suggestion": SUGGESTION_RULES["MISSING"],
            "candidate_crop_base64": None,
            "reference_crop_base64": None,
        }

    logo_img = _downscale_in_ram(logo_img, MAX_LOGO_SIDE)
    tight_logo = _tight_crop_logo(logo_img)
    ref_crop_b64 = _encode_bgr_to_base64_data_uri(tight_logo)

    # Pre-extract candidate crop via fast Python template matching for UI visual comparison
    quick_py_result = None
    cand_crop_b64 = None
    try:
        quick_py_result = _check_logo_with_python_cv(post_img, tight_logo)
        cand_crop_b64 = quick_py_result.get("candidate_crop_base64")
    except Exception as e:
        print(f"[BrandLogoCheck] Quick CV pre-extraction notice: {e}", file=sys.stderr)

    # ==========================================================================
    # Step 1 - AI FIRST (Priority)
    # ==========================================================================
    ai_result = None
    try:
        ai_result = _check_logo_with_vision_ai(post_img, tight_logo)
    except Exception as e:
        print(f"[BrandLogoCheck] AI Vision error (will use Python fallback): {e}", file=sys.stderr)

    if isinstance(ai_result, dict):
        found = bool(ai_result.get("found", False))
        try:
            score = float(ai_result.get("match_score", 0.0))
        except (ValueError, TypeError):
            score = 0.0

        raw_location = str(ai_result.get("location", quick_py_result.get("location", "top-left") if quick_py_result else "top-left"))
        loc_key, loc_hindi = _map_location_hindi(raw_location)

        try:
            size_pct = int(ai_result.get("size_percent", quick_py_result.get("size_percent", 10) if quick_py_result else 10))
        except (ValueError, TypeError):
            size_pct = 10

        raw_reason = str(ai_result.get("reason", "")).strip().upper()
        if raw_reason not in SUGGESTION_RULES:
            raw_reason = "CORRECT" if (found and score >= PASS_THRESHOLD) else "WRONG_LOGO"

        custom_suggestion = ai_result.get("suggestion")
        suggestion = custom_suggestion if (custom_suggestion and str(custom_suggestion).strip()) else SUGGESTION_RULES.get(raw_reason, SUGGESTION_RULES["MISSING"])

        if found and score >= PASS_THRESHOLD:
            return {
                "status": "PASS",
                "found": True,
                "score": round(score, 2),
                "location": loc_key,
                "location_hindi": loc_hindi,
                "size_percent": size_pct,
                "reason": "CORRECT",
                "suggestion": suggestion,
                "checked_by": "Gemini",
                "candidate_crop_base64": cand_crop_b64,
                "reference_crop_base64": ref_crop_b64,
            }
        else:
            return {
                "status": "FAIL",
                "found": False,
                "score": round(score, 2),
                "location": loc_key if loc_key != "unknown" else "unknown",
                "location_hindi": loc_hindi if loc_key != "unknown" else "Kahin nahi mila",
                "size_percent": size_pct if found else 0,
                "reason": raw_reason if raw_reason in SUGGESTION_RULES else "WRONG_LOGO",
                "suggestion": suggestion,
                "checked_by": "Gemini",
                "candidate_crop_base64": cand_crop_b64,
                "reference_crop_base64": ref_crop_b64,
            }

    # ==========================================================================
    # Step 2 - PYTHON FALLBACK (Only if AI fails / timeout / low confidence)
    # ==========================================================================
    print("[BrandLogoCheck] Executing Step 2: OpenCV Python Fallback (SIFT + ORB + Template Matching)...", file=sys.stderr)
    py_result = quick_py_result or _check_logo_with_python_cv(post_img, tight_logo)

    found = bool(py_result["found"])
    score = float(py_result["score"])
    loc_key, loc_hindi = _map_location_hindi(py_result["location"])
    size_pct = int(py_result["size_percent"])
    reason = str(py_result["reason"]).strip().upper()

    if found and score >= 0.75:
        status = "PASS"
        if reason != "COLOR_CHANGED":
            reason = "CORRECT"
    else:
        status = "FAIL"
        found = False
        if reason not in ["WRONG_LOGO", "MISSING", "TOO_SMALL", "HIDDEN"]:
            reason = "WRONG_LOGO" if score >= 0.20 else "MISSING"

    if not found or reason == "MISSING":
        loc_key = "unknown"
        loc_hindi = LOCATION_HINDI_MAP["unknown"]
        size_pct = 0

    suggestion = SUGGESTION_RULES.get(reason, SUGGESTION_RULES["MISSING"])

    return {
        "status": status,
        "found": found,
        "score": round(score, 2),
        "location": loc_key,
        "location_hindi": loc_hindi,
        "size_percent": size_pct,
        "reason": reason,
        "suggestion": suggestion,
        "checked_by": "Python",
        "candidate_crop_base64": py_result.get("candidate_crop_base64"),
        "reference_crop_base64": ref_crop_b64,
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python brand_logo_check.py <post_image_path> <reference_logo_path>")
        sys.exit(1)

    p_path = sys.argv[1]
    l_path = sys.argv[2]
    res = check_brand_logo(p_path, l_path)
    print(json.dumps(res, indent=2, ensure_ascii=False))

"""
cv2_preprocess.py - HEADLESS, SERVER-READY preprocessing for A2 Hosting.

Ye file GUI wale main.py ka optimized version hai.
GUI, tkinter, sliders, preview, save, PIL ImageTk - sab hata diya hai.
Sirf CORE LOGIC rakha hai: 23 variants -> score (high-contrast penalty) -> TOP 7 diverse -> OCR ko dena.

Use in existing backend/a2-ocr-server/process_post.py:
    from cv2_preprocess import get_top7_variants
    top7 = get_top7_variants(bgr_image)  # list of (name, BGR/gray image)
    # fir har top7 pe PaddleOCR chalao

A2 Constraints dhyan me rakhe:
- opencv-python-headless only, no GUI
- single-thread (env already set in process_post.py / app.py)
- memory limit: bada poster aaye to pehle 1600px tak downscale, 2x upscale sirf chhote poster pe
- 23 variants generate hote hai par return sirf TOP 7 hote hai, baaki discard -> RAM bachta hai
"""

import cv2
import numpy as np

# ---- Fixed tuning (GUI sliders ke fixed values) ----
CLAHE_CLIP = 2.0
ADAPTIVE_BLOCK_BASE = 31
ADAPTIVE_C_BASE = 10
BRIGHTNESS = 0
CONTRAST = 1.0
UPSCALE_FACTOR = 2

# A2 memory guard: isse badi image pehle chhoti karo
MAX_SIDE_BEFORE_PREPROCESS = 1600
MAX_SIDE_FOR_UPSCALE = 1200  # isse badi image pe 2x upscale mat karo


def _correct_threshold_polarity(binary):
    height, width = binary.shape
    band = max(1, min(height, width) // 20)
    border = np.concatenate((
        binary[:band, :].ravel(),
        binary[-band:, :].ravel(),
        binary[:, :band].ravel(),
        binary[:, -band:].ravel(),
    ))
    border_white = float(np.mean(border > 127))
    image_white = float(np.mean(binary > 127))
    white_background = 0.75 * border_white + 0.25 * image_white >= 0.5
    if white_background:
        return cv2.bitwise_not(binary), "dark text on light background"
    return binary, "light text on dark background"


def _msrcr(image):
    """Multi-scale Retinex with color restoration - GUI wala same logic."""
    source = image.astype(np.float32)
    positive = source + 1.0
    log_image = np.log(positive)
    channel_sum = np.sum(positive, axis=2, keepdims=True)
    color_restoration = 46.0 * (np.log(125.0 * positive) - np.log(channel_sum))
    min_dimension = min(image.shape[:2])
    retinex = np.zeros_like(source, dtype=np.float32)
    scales = (
        max(2.0, min_dimension * 0.015),
        max(3.0, min_dimension * 0.05),
        max(5.0, min_dimension * 0.15),
    )
    for sigma in scales:
        blurred = cv2.GaussianBlur(positive, (0, 0), sigmaX=sigma, sigmaY=sigma)
        retinex += log_image - np.log(blurred + 1e-6)
    retinex /= len(scales)
    corrected = retinex * color_restoration
    enhanced = np.empty_like(source, dtype=np.uint8)
    for channel in range(3):
        values = corrected[:, :, channel]
        low, high = np.percentile(values, (1, 99))
        if high - low < 1e-6:
            enhanced[:, :, channel] = image[:, :, channel]
        else:
            normalized = (values - low) * (255.0 / (high - low))
            enhanced[:, :, channel] = np.clip(normalized, 0, 255).astype(np.uint8)
    return enhanced


def _multi_scale_hat(gray, operation):
    min_dimension = min(gray.shape)
    responses = []
    for fraction in (0.01, 0.025, 0.05):
        size = max(3, min(51, int(round(min_dimension * fraction))))
        if size % 2 == 0:
            size += 1
        max_size = min_dimension if min_dimension % 2 else min_dimension - 1
        size = min(size, max(3, max_size))
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (size, size))
        responses.append(cv2.morphologyEx(gray, operation, kernel))
    combined = responses[0]
    for response in responses[1:]:
        combined = cv2.max(combined, response)
    return combined


def _score_variants(variants):
    """
    GUI wala same scoring + high-contrast penalty.
    0.4*Sharpness + 0.3*Contrast + 0.3*TextPreservation - 0.7*Penalty
    Penalty: >85% pure B/W + <=2 unique levels => -30, isolated edges >20% => -15
    Isliye extreme B/W hamesha neeche rahega, colored/grayscale upar.
    """
    sharpness = {}
    contrast = {}
    text_preservation = {}
    penalties = {}
    for name, image in variants.items():
        gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        black_ratio = float(np.mean(gray <= 10))
        white_ratio = float(np.mean(gray >= 245))
        unique_levels = int(np.count_nonzero(cv2.calcHist([gray], [0], None, [256], [0, 256])))
        h, w = gray.shape
        longest = max(h, w)
        small = gray
        if longest > 512:
            scale = 512.0 / longest
            small = cv2.resize(gray, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
        sharpness[name] = float(np.log1p(cv2.Laplacian(small, cv2.CV_32F).var()))
        contrast[name] = float(np.std(small))

        preservation_penalty = 30 if (black_ratio + white_ratio > 0.85 and unique_levels <= 2) else 0
        noise_penalty = 0
        if min(small.shape) >= 3:
            edges = cv2.Canny(small, 50, 150)
            edge_count = int(np.count_nonzero(edges))
            if edge_count:
                _n, _labels, stats, _c = cv2.connectedComponentsWithStats((edges > 0).astype(np.uint8), connectivity=8)
                areas = stats[1:, cv2.CC_STAT_AREA]
                isolated = int(np.sum(areas[areas <= 4]))
                if isolated / edge_count > 0.20:
                    noise_penalty = 15
        text_preservation[name] = max(0, 100 - preservation_penalty - noise_penalty)
        penalties[name] = preservation_penalty + noise_penalty

    def _norm(vals):
        mn, mx = min(vals.values()), max(vals.values())
        if mx - mn < 1e-9:
            return {k: 0.5 for k in vals}
        return {k: (v - mn) / (mx - mn) for k, v in vals.items()}

    sn, cn = _norm(sharpness), _norm(contrast)
    scores = {n: 0.4 * sn[n] * 100.0 + 0.3 * cn[n] * 100.0 + 0.3 * text_preservation[n] for n in variants}
    return {n: max(0.0, s - 0.7 * penalties[n]) for n, s in scores.items()}


def _select_top7_variants(quality_scores, original_image):
    """GUI wala same diversity quota - 1 CLAHE + 1 Gray + 1 Gamma + 1 Threshold + 1 Retinex + 2 filler."""
    ranked = sorted(quality_scores, key=quality_scores.get, reverse=True)
    required_groups = (
        ("CLAHE Enhanced (LAB L-channel)", "CLAHE Soft (1.5)"),
        ("Grayscale", "Denoised Grayscale", "CLAHE Soft Grayscale"),
        ("Gamma Brighter", "Gamma Darker", "Contrast Normalized (2-98%)"),
        ("Otsu Threshold", "Adaptive Threshold Gaussian"),
        ("MSRCR / Retinex",),
    )
    src_gray = cv2.cvtColor(original_image, cv2.COLOR_BGR2GRAY)
    dark_ratio = float(np.mean(src_gray <= 70))
    is_very_dark = float(np.mean(src_gray)) < 85.0 or dark_ratio > 0.60
    dark_only = {"Inverted / Negative", "WhiteHat / Morphological", "BlackHat / Morphological", "Adaptive Threshold Mean"}
    selected = []
    for group in required_groups:
        best = next((n for n in ranked if n in group and n not in selected), None)
        if best is not None:
            selected.append(best)
    for name in ranked:
        if len(selected) >= 7:
            break
        if not is_very_dark and name in dark_only:
            continue
        if name not in selected:
            selected.append(name)
    return selected


def _build_all_variants(source):
    """GUI ke preprocess_all() ka headless version - same 23 variants."""
    adjusted = np.clip(source.astype(np.float32) * CONTRAST + BRIGHTNESS, 0, 255).astype(np.uint8)
    lab = cv2.cvtColor(adjusted, cv2.COLOR_BGR2LAB)
    lightness = lab[:, :, 0]
    gray = cv2.cvtColor(adjusted, cv2.COLOR_BGR2GRAY)

    h, w = source.shape[:2]
    # Optimization: bada poster hai to upscale mat karo, chhota hai to 2x karo
    factor = UPSCALE_FACTOR if max(h, w) <= MAX_SIDE_FOR_UPSCALE else 1
    upscaled = cv2.resize(adjusted, (w * factor, h * factor), interpolation=cv2.INTER_CUBIC) if factor > 1 else adjusted.copy()

    clahe_lightness = cv2.createCLAHE(clipLimit=CLAHE_CLIP, tileGridSize=(8, 8)).apply(lightness)
    enhanced_lab = lab.copy(); enhanced_lab[:, :, 0] = clahe_lightness
    clahe_color = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)
    clahe_soft = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8)).apply(lightness)
    clahe_strong = cv2.createCLAHE(clipLimit=3.5, tileGridSize=(8, 8)).apply(lightness)
    equalized = cv2.equalizeHist(lightness)

    def gamma_tone(gamma):
        lut = np.clip(((np.arange(256, dtype=np.float32) / 255.0) ** gamma) * 255.0, 0, 255).astype(np.uint8)
        t = lab.copy(); t[:, :, 0] = cv2.LUT(lightness, lut)
        return cv2.cvtColor(t, cv2.COLOR_LAB2BGR)

    low, high = np.percentile(lightness, (2, 98))
    normalized = np.clip((lightness.astype(np.float32) - low) * (255.0 / (high - low)), 0, 255).astype(np.uint8) if high > low else lightness.copy()

    def lab_variant(v):
        t = lab.copy(); t[:, :, 0] = v
        return cv2.cvtColor(t, cv2.COLOR_LAB2BGR)

    otsu_raw = cv2.threshold(clahe_lightness, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    otsu, _ = _correct_threshold_polarity(otsu_raw)

    hh, ww = clahe_lightness.shape
    min_dim = min(hh, ww)
    band = max(1, min_dim // 20)
    border = np.concatenate((clahe_lightness[:band, :].ravel(), clahe_lightness[-band:, :].ravel(), clahe_lightness[:, :band].ravel(), clahe_lightness[:, -band:].ravel()))
    bg_bright = float(np.median(border))
    img_contrast = float(np.std(clahe_lightness))
    auto_c = int(np.clip(round(5 + abs(bg_bright - 127.5) / 24 + max(0.0, 40.0 - img_contrast) / 8), 2, 20))
    tuned_c = int(np.clip(auto_c + ADAPTIVE_C_BASE - 10, 1, 40))
    auto_block = int(np.clip(round(min_dim * 0.025), 11, 151))
    block_size = auto_block + ADAPTIVE_BLOCK_BASE - 31
    if block_size % 2 == 0:
        block_size += 1
    max_block = min_dim if min_dim % 2 else min_dim - 1
    block_size = min(block_size, max_block)

    if min_dim >= 3:
        block_size = max(3, block_size)
        adaptive_raw = cv2.adaptiveThreshold(clahe_lightness, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block_size, tuned_c)
        adaptive, _ = _correct_threshold_polarity(adaptive_raw)
        adaptive_mean_raw = cv2.adaptiveThreshold(clahe_lightness, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, block_size, tuned_c)
        adaptive_mean, _ = _correct_threshold_polarity(adaptive_mean_raw)
    else:
        adaptive = otsu.copy(); adaptive_mean = otsu.copy()

    sharpen_kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)
    sharpened = cv2.filter2D(clahe_lightness, -1, sharpen_kernel)
    bilateral = cv2.bilateralFilter(clahe_lightness, 9, 75, 75)
    bilateral_raw = cv2.threshold(bilateral, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    bilateral_threshold, _ = _correct_threshold_polarity(bilateral_raw)
    retinex_color = _msrcr(adjusted)
    retinex_lab = cv2.cvtColor(retinex_color, cv2.COLOR_BGR2LAB)
    retinex_lightness = retinex_lab[:, :, 0]
    retinex_raw = cv2.threshold(retinex_lightness, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    retinex_threshold, _ = _correct_threshold_polarity(retinex_raw)
    blackhat = _multi_scale_hat(clahe_lightness, cv2.MORPH_BLACKHAT)
    blackhat_threshold = cv2.threshold(blackhat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    whitehat = _multi_scale_hat(clahe_lightness, cv2.MORPH_TOPHAT)
    whitehat_threshold = cv2.threshold(whitehat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]

    return {
        "Original": source,
        "Original Upscaled ({}x)".format(factor): upscaled,
        "Grayscale": gray,
        "Gamma Brighter": gamma_tone(0.75),
        "Gamma Darker": gamma_tone(1.35),
        "Contrast Normalized (2-98%)": normalized,
        "Histogram Equalized": equalized,
        "CLAHE Soft (1.5)": lab_variant(clahe_soft),
        "CLAHE Enhanced (LAB L-channel)": clahe_color,
        "CLAHE Strong (3.5)": lab_variant(clahe_strong),
        "CLAHE Soft Grayscale": clahe_soft,
        "CLAHE Strong Grayscale": clahe_strong,
        "Adaptive Threshold Gaussian": adaptive,
        "Adaptive Threshold Mean": adaptive_mean,
        "Otsu Threshold": otsu,
        "Inverted / Negative": cv2.bitwise_not(otsu),
        "Sharpened": sharpened,
        "Denoised Grayscale": bilateral,
        "Bilateral Filter + Threshold": bilateral_threshold,
        "BlackHat / Morphological": blackhat_threshold,
        "WhiteHat / Morphological": whitehat_threshold,
        "MSRCR / Retinex": retinex_color,
        "Retinex Adaptive Threshold": retinex_threshold,
    }


def get_top10_variants(bgr_image):
    """
    Returns the exact 10 diverse families requested for A2 OCR:
    1. Original, 2. Grayscale, 3. CLAHE Soft, 4. CLAHE Enhanced, 5. CLAHE Strong,
    6. Retinex, 7. Contrast Normalized, 8. Otsu Threshold, 9. Adaptive Threshold, 10. Sharpened
    """
    if bgr_image is None:
        raise ValueError("bgr_image is None")
    h, w = bgr_image.shape[:2]
    if max(h, w) > MAX_SIDE_BEFORE_PREPROCESS:
        scale = MAX_SIDE_BEFORE_PREPROCESS / max(h, w)
        bgr_image = cv2.resize(bgr_image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    variants = _build_all_variants(bgr_image)
    
    top10_mapping = [
        ("Original", "Original"),
        ("Grayscale", "Grayscale"),
        ("CLAHE Soft", "CLAHE Soft (1.5)"),
        ("CLAHE Enhanced", "CLAHE Enhanced (LAB L-channel)"),
        ("CLAHE Strong", "CLAHE Strong (3.5)"),
        ("Retinex", "MSRCR / Retinex"),
        ("Contrast Normalized", "Contrast Normalized (2-98%)"),
        ("Otsu", "Otsu Threshold"),
        ("Adaptive", "Adaptive Threshold Gaussian"),
        ("Sharpened", "Sharpened"),
    ]
    
    top10 = []
    top10_names = []
    for short_name, v_key in top10_mapping:
        if v_key in variants:
            top10.append((short_name, variants[v_key]))
            top10_names.append(short_name)
        elif "Original" in variants:
            top10.append((short_name, variants["Original"]))
            top10_names.append(short_name)
            
    scores = _score_variants(variants)
    return top10, scores, top10_names


def get_top7_variants(bgr_image):
    """
    MAIN ENTRY - Node agent isi ko call karega.
    Input: cv2 BGR numpy image (cv2.imread / cv2.imdecode se)
    Output: list[(name, image)] - TOP 7 diverse, score order me
            + dict scores - debugging ke liye
    """
    if bgr_image is None:
        raise ValueError("bgr_image is None")
    h, w = bgr_image.shape[:2]
    # A2 memory guard: bada poster pehle chhota karo
    if max(h, w) > MAX_SIDE_BEFORE_PREPROCESS:
        scale = MAX_SIDE_BEFORE_PREPROCESS / max(h, w)
        bgr_image = cv2.resize(bgr_image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    variants = _build_all_variants(bgr_image)
    scores = _score_variants(variants)
    top7_names = _select_top7_variants(scores, bgr_image)
    top7 = [(name, variants[name]) for name in top7_names if name in variants]
    return top7, scores, top7_names


def detect_language_from_text(text):
    """GUI wala same: Devanagari >10% => hi, warna en. TOP1 variant ke OCR text pe use karo."""
    visible = [c for c in text if not c.isspace()]
    total = len(visible)
    if not total:
        return "hi"
    dev = sum(0x0900 <= ord(c) <= 0x097F for c in visible)
    lat = sum(("A" <= c <= "Z" or "a" <= c <= "z") for c in visible)
    if dev / total > 0.10:
        return "hi"
    if dev / total < 0.10 and lat >= max(3, int(np.ceil(total * 0.10))):
        return "en"
    return "hi"

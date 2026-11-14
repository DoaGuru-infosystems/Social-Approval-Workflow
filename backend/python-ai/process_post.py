import os


THREAD_ENV = (
    "OPENBLAS_NUM_THREADS",
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "OPENCV_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
    "BLIS_NUM_THREADS",
)
for variable in THREAD_ENV:
    os.environ[variable] = "1"


import json
import re
import sys
from contextlib import redirect_stdout
from pathlib import Path


OCR_CONFIDENCE_THRESHOLD = 0.5
HINDI_DICTIONARY = Path(__file__).resolve().parent / "dictionaries" / "hi_IN" / "hi_IN"
WORD_PATTERN = re.compile(r"[\u0900-\u097f]+|[A-Za-z]+(?:['’][A-Za-z]+)*")


def _string_list(value, field_name):
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError(f"{field_name} must be a list of strings.")
    return [item.strip() for item in value if item.strip()]


def _load_dictionaries():
    try:
        from spylls.hunspell import Dictionary
    except ImportError as error:
        raise RuntimeError(f"spylls is not installed: {error}") from error

    try:
        english = Dictionary.from_files("en_US")
        english_fallback = None
    except Exception as error:
        print(f"spylls en_US dictionary unavailable; using pyspellchecker fallback: {error}", file=sys.stderr)
        try:
            from spellchecker import SpellChecker

            english = None
            english_fallback = SpellChecker(language="en")
        except Exception as fallback_error:
            raise RuntimeError(f"Unable to load an English dictionary: {fallback_error}") from fallback_error

    try:
        hindi = Dictionary.from_files(str(HINDI_DICTIONARY))
    except Exception as error:
        raise RuntimeError(f"Unable to load the hi_IN Hunspell dictionary: {error}") from error

    return english, english_fallback, hindi


def _suggestions(dictionary, fallback, word):
    if dictionary is not None:
        return list(dictionary.suggest(word))[:5]
    candidates = fallback.candidates(word) or set()
    return sorted(candidates, key=lambda item: (-fallback.word_frequency.frequency(item), item))[:5]


def _is_correct(dictionary, fallback, word):
    if dictionary is not None:
        return dictionary.lookup(word) or dictionary.lookup(word.lower())
    return word in fallback or word.lower() in fallback


def _check_spelling(text, whitelist, english, english_fallback, hindi):
    issues = []
    checked = set()

    for word in WORD_PATTERN.findall(text):
        is_hindi = any("\u0900" <= character <= "\u097f" for character in word)
        script = "hindi" if is_hindi else "english"
        dictionary = hindi if is_hindi else english
        fallback = None if is_hindi else english_fallback
        key = (script, word.casefold())

        if key in checked:
            continue
        checked.add(key)

        if word.casefold() in whitelist:
            continue

        if not _is_correct(dictionary, fallback, word):
            issues.append(
                {
                    "word": word,
                    "script": script,
                    "suggestions": _suggestions(dictionary, fallback, word),
                }
            )

    return issues


def _find_banned_words(text, banned_words):
    found = []
    lowered_text = text.casefold()

    for word in banned_words:
        clean_word = word.strip()
        if not clean_word:
            continue

        lowered_word = clean_word.casefold()
        if re.fullmatch(r"[a-z0-9\s_-]+", lowered_word):
            matched = re.search(
                rf"(?<![a-z0-9]){re.escape(lowered_word)}(?![a-z0-9])",
                lowered_text,
            )
        else:
            matched = lowered_word in lowered_text

        if matched and clean_word not in found:
            found.append(clean_word)

    return found


def process_post(data):
    if not isinstance(data, dict):
        raise ValueError("Input must be a JSON object.")

    title = data.get("title", "")
    caption = data.get("caption", "")
    title = "" if title is None else title
    caption = "" if caption is None else caption
    if not isinstance(title, str) or not isinstance(caption, str):
        raise ValueError("title and caption must be strings.")

    whitelist = {
        word.casefold() for word in _string_list(data.get("whitelist_words"), "whitelist_words")
    }
    banned_words = _string_list(data.get("banned_words"), "banned_words")
    mandatory_phrases = _string_list(data.get("mandatory_phrases"), "mandatory_phrases")
    image_path = data.get("image_path")

    ocr_text = ""
    ocr_confidence_avg = 0.0
    ocr_reliable = False
    if image_path is not None and not isinstance(image_path, str):
        raise ValueError("image_path must be a string or null.")
    if image_path:
        resolved_image_path = Path(image_path).expanduser().resolve()
        if not resolved_image_path.is_file():
            raise FileNotFoundError(f"Image file does not exist: {resolved_image_path}")

        try:
            import cv2

            cv2.setNumThreads(1)
            import torch

            torch.set_num_threads(1)
            torch.set_num_interop_threads(1)
            import easyocr

            reader = easyocr.Reader(["en", "hi"])
            detections = reader.readtext(str(resolved_image_path), detail=1)
        except Exception as error:
            raise RuntimeError(f"EasyOCR could not read the image: {error}") from error

        blocks = []
        confidences = []
        for detection in detections:
            if len(detection) < 3:
                continue
            block_text = str(detection[1]).strip()
            if block_text:
                blocks.append(block_text)
                confidences.append(float(detection[2]))

        ocr_text = "\n".join(blocks)
        if confidences:
            ocr_confidence_avg = sum(confidences) / len(confidences)
            ocr_reliable = ocr_confidence_avg >= OCR_CONFIDENCE_THRESHOLD

    english, english_fallback, hindi = _load_dictionaries()
    base_text = f"{title}\n{caption}"
    ocr_issues = (
        _check_spelling(ocr_text, whitelist, english, english_fallback, hindi)
        if ocr_reliable
        else []
    )
    spelling_issues = _check_spelling(base_text, whitelist, english, english_fallback, hindi)
    if ocr_reliable:
        known_issues = {(issue["script"], issue["word"].casefold()) for issue in spelling_issues}
        for issue in ocr_issues:
            key = (issue["script"], issue["word"].casefold())
            if key not in known_issues:
                spelling_issues.append(issue)
                known_issues.add(key)

    checked_text = f"{title}\n{caption}"
    if ocr_reliable:
        checked_text = f"{checked_text}\n{ocr_text}"

    caption_lower = caption.casefold()
    missing_mandatory_phrases = [
        phrase for phrase in mandatory_phrases if phrase.casefold() not in caption_lower
    ]

    return {
        "ocr_text": ocr_text,
        "ocr_reliable": ocr_reliable,
        "ocr_confidence_avg": round(ocr_confidence_avg, 4),
        "spelling_issues": spelling_issues,
        "ocr_issues": ocr_issues,
        "banned_words_found": _find_banned_words(checked_text, banned_words),
        "missing_mandatory_phrases": missing_mandatory_phrases,
    }


def main():
    try:
        data = json.loads(sys.stdin.buffer.read())
        with redirect_stdout(sys.stderr):
            result = process_post(data)
    except Exception as error:
        print(f"Python AI check failed: {error}", file=sys.stderr)
        result = {"error": str(error), "ocr_reliable": False}

    sys.stdout.buffer.write(json.dumps(result).encode("ascii") + b"\n")


if __name__ == "__main__":
    main()

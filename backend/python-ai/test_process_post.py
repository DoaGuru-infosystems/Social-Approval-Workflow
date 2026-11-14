import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

import process_post


IMAGE_PATH = Path(__file__).resolve().parents[1] / "test-assets" / "hindi-simple.png"


class MockHunspellDict:
    def __init__(self, correct_words=None):
        self.correct_words = {w.casefold() for w in (correct_words or [])}

    def lookup(self, word):
        return word.casefold() in self.correct_words

    def suggest(self, word):
        return [f"fix_{word}"]


def make_mock_dictionaries():
    return (
        MockHunspellDict(["healthy", "good"]),
        None,
        MockHunspellDict(["नमस्ते"]),
    )


def fake_paddleocr(detections):
    class PaddleOCR:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def ocr(self, image_path, cls=True):
            return detections

    return SimpleNamespace(PaddleOCR=PaddleOCR)


class ProcessPostTests(unittest.TestCase):
    def setUp(self):
        self.dictionaries = make_mock_dictionaries()

    def test_low_confidence_text_is_not_spelling_or_banned_checked(self):
        fake_detections = [
            [
                [[[0, 0], [10, 0], [10, 10], [0, 10]], ("Welcom", 0.4)],
            ]
        ]
        fake_module = fake_paddleocr(fake_detections)
        with patch.dict(sys.modules, {"paddleocr": fake_module}):
            result = process_post.process_post(
                {
                    "image_path": str(IMAGE_PATH),
                    "title": "Healthy",
                    "caption": "Good",
                    "whitelist_words": [],
                    "banned_words": ["Welcom"],
                    "mandatory_phrases": [],
                },
                dictionaries=self.dictionaries,
            )

        self.assertEqual(result["ocr_text"], "Welcom")
        self.assertFalse(result["ocr_reliable"])
        self.assertEqual(result["ocr_issues"], [])
        self.assertNotIn("Welcom", [issue["word"] for issue in result["spelling_issues"]])
        self.assertEqual(result["banned_words_found"], [])

    def test_reliable_ocr_text_is_spelling_and_banned_checked(self):
        fake_detections = [
            [
                [[[0, 0], [10, 0], [10, 10], [0, 10]], ("Welcom", 0.9)],
            ]
        ]
        fake_module = fake_paddleocr(fake_detections)
        with patch.dict(sys.modules, {"paddleocr": fake_module}):
            result = process_post.process_post(
                {
                    "image_path": str(IMAGE_PATH),
                    "title": "Healthy",
                    "caption": "Good",
                    "whitelist_words": [],
                    "banned_words": ["Welcom"],
                    "mandatory_phrases": [],
                },
                dictionaries=self.dictionaries,
            )

        self.assertTrue(result["ocr_reliable"])
        self.assertIn("Welcom", [issue["word"] for issue in result["ocr_issues"]])
        self.assertIn("Welcom", [issue["word"] for issue in result["spelling_issues"]])
        self.assertEqual(result["banned_words_found"], ["Welcom"])


if __name__ == "__main__":
    unittest.main()

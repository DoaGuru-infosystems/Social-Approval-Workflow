import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import process_post


IMAGE_PATH = Path(__file__).resolve().parents[1] / "test-assets" / "hindi-simple.png"


def fake_easyocr(detections):
    class Reader:
        def __init__(self, languages):
            if languages != ["en", "hi"]:
                raise AssertionError(f"Unexpected OCR languages: {languages}")

        def readtext(self, image_path, detail):
            if detail != 1:
                raise AssertionError(f"Unexpected OCR detail setting: {detail}")
            return detections

    return SimpleNamespace(Reader=Reader)


class ProcessPostTests(unittest.TestCase):
    def test_low_confidence_text_is_not_spelling_or_banned_checked(self):
        fake_module = fake_easyocr([([], "Welcom", 0.4)])
        cv2 = SimpleNamespace(setNumThreads=Mock())
        torch = SimpleNamespace(set_num_threads=Mock(), set_num_interop_threads=Mock())
        with patch.dict(sys.modules, {"cv2": cv2, "torch": torch, "easyocr": fake_module}):
            result = process_post.process_post(
                {
                    "image_path": str(IMAGE_PATH),
                    "title": "Healthy",
                    "caption": "Good",
                    "whitelist_words": [],
                    "banned_words": ["Welcom"],
                    "mandatory_phrases": [],
                }
            )

        cv2.setNumThreads.assert_called_once_with(1)
        torch.set_num_threads.assert_called_once_with(1)
        torch.set_num_interop_threads.assert_called_once_with(1)
        self.assertEqual(result["ocr_text"], "Welcom")
        self.assertFalse(result["ocr_reliable"])
        self.assertEqual(result["ocr_issues"], [])
        self.assertNotIn("Welcom", [issue["word"] for issue in result["spelling_issues"]])
        self.assertEqual(result["banned_words_found"], [])

    def test_reliable_ocr_text_is_spelling_and_banned_checked(self):
        fake_module = fake_easyocr([([], "Welcom", 0.9)])
        cv2 = SimpleNamespace(setNumThreads=Mock())
        torch = SimpleNamespace(set_num_threads=Mock(), set_num_interop_threads=Mock())
        with patch.dict(sys.modules, {"cv2": cv2, "torch": torch, "easyocr": fake_module}):
            result = process_post.process_post(
                {
                    "image_path": str(IMAGE_PATH),
                    "title": "Healthy",
                    "caption": "Good",
                    "whitelist_words": [],
                    "banned_words": ["Welcom"],
                    "mandatory_phrases": [],
                }
            )

        self.assertTrue(result["ocr_reliable"])
        self.assertIn("Welcom", [issue["word"] for issue in result["ocr_issues"]])
        self.assertIn("Welcom", [issue["word"] for issue in result["spelling_issues"]])
        self.assertEqual(result["banned_words_found"], ["Welcom"])


if __name__ == "__main__":
    unittest.main()

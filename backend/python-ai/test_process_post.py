import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

import process_post

IMAGE_PATH = Path(__file__).resolve().parents[1] / "test-assets" / "hindi-simple.png"


def fake_paddleocr(detections):
    class PaddleOCR:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def ocr(self, image_path, cls=True):
            return detections

    return SimpleNamespace(PaddleOCR=PaddleOCR)


class ProcessPostTests(unittest.TestCase):
    def test_low_confidence_blocks_excluded_and_counts_tracked(self):
        fake_detections = [
            [
                [[[0, 0], [10, 0], [10, 10], [0, 10]], ("Welcom", 0.4)],
            ]
        ]
        fake_module = fake_paddleocr(fake_detections)
        with patch.dict(sys.modules, {"paddleocr": fake_module}):
            result = process_post.process_post({"image_path": str(IMAGE_PATH)})

        self.assertEqual(result["ocr_text"], "")
        self.assertFalse(result["ocr_reliable"])
        self.assertEqual(result["ocr_blocks_total"], 1)
        self.assertEqual(result["ocr_blocks_excluded_low_confidence"], 1)
        self.assertEqual(result["ocr_confidence_avg"], 0.4)

    def test_per_block_confidence_filtering(self):
        fake_detections = [
            [
                [[[0, 0], [10, 0], [10, 10], [0, 10]], ("GoodText", 0.92)],
                [[[0, 20], [10, 20], [10, 30], [0, 30]], ("NoiseGarbage", 0.35)],
            ]
        ]
        fake_module = fake_paddleocr(fake_detections)
        with patch.dict(sys.modules, {"paddleocr": fake_module}):
            result = process_post.process_post({"image_path": str(IMAGE_PATH)})

        self.assertEqual(result["ocr_text"], "GoodText")
        self.assertNotIn("NoiseGarbage", result["ocr_text"])
        self.assertTrue(result["ocr_reliable"])
        self.assertEqual(result["ocr_blocks_total"], 2)
        self.assertEqual(result["ocr_blocks_excluded_low_confidence"], 1)
        self.assertAlmostEqual(result["ocr_confidence_avg"], 0.92, places=2)

    def test_reliable_ocr_text_extraction(self):
        fake_detections = [
            [
                [[[0, 0], [10, 0], [10, 10], [0, 10]], ("नमस्ते Apex 2026", 0.95)],
            ]
        ]
        fake_module = fake_paddleocr(fake_detections)
        with patch.dict(sys.modules, {"paddleocr": fake_module}):
            result = process_post.process_post({"image_path": str(IMAGE_PATH)})

        self.assertTrue(result["ocr_reliable"])
        self.assertEqual(result["ocr_text"], "नमस्ते Apex 2026")
        self.assertEqual(result["ocr_blocks_total"], 1)
        self.assertEqual(result["ocr_blocks_excluded_low_confidence"], 0)
        self.assertAlmostEqual(result["ocr_confidence_avg"], 0.95, places=2)


if __name__ == "__main__":
    unittest.main()

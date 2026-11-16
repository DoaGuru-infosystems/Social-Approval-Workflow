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

    def test_top1_authoritative_baseline_and_duplicate_suppression(self):
        from unittest.mock import MagicMock
        mock_reader = MagicMock()
        mock_reader.ocr.side_effect = [
            # Call 1: TOP 1
            [
                [
                    [[[0, 0]], ("दवस, इस उहें िसफ खुिशयाँ नही...", 0.92)],
                    [[[0, 0]], ("BAL. COPALCHILDREN'E NEURO cLINIC", 0.91)],
                    [[[0, 0]], ("OPD 8989590477", 0.96)],
                    [[[0, 0]], ("8447095305", 0.90)],
                ]
            ],
            # Call 2: Variant 2 (duplicates with minor spelling variations)
            [
                [
                    [[[0, 0]], ("बाल COPALCHILDREN'S NEURO CLINIC", 0.92)],
                    [[[0, 0]], ("8989590477", 0.95)],
                ]
            ],
            # Call 3: Variant 3 (more duplicates)
            [
                [
                    [[[0, 0]], ("COPAL LCHILDREN'S NEVRO CLINIC", 0.86)],
                    [[[0, 0]], ("िदवस", 0.87)],
                ]
            ],
            # Call 4: Variant 4 (truly missing text that SHOULD be added!)
            [
                [
                    [[[0, 0]], ("टीकाकरण", 0.94)],
                    [[[0, 0]], ("जबलपुर", 0.93)],
                ]
            ],
            # Call 5: Variant 5
            [
                [
                    [[[0, 0]], ("िदवसृ", 0.78)],
                ]
            ],
            # Call 6: Variant 6
            [
                [
                    [[[0, 0]], ("8989590477", 0.96)],
                ]
            ],
            # Call 7: Variant 7 (phone misread 9989590477)
            [
                [
                    [[[0, 0]], ("9989590477", 0.89)],
                ]
            ],
        ]

        result = process_post.process_post(
            {"image_path": str(IMAGE_PATH), "expected_phones": ["8989590477", "8447096306"]},
            reader=mock_reader,
        )

        extracted = result["ocr_text"]
        # 1. TOP 1 is primary:
        self.assertIn("दवस, इस उहें िसफ खुिशयाँ नही...", extracted)
        self.assertIn("BAL. COPALCHILDREN'E NEURO cLINIC", extracted)
        self.assertIn("8989590477", extracted)
        self.assertIn("8447096306", extracted)

        # 2. Truly missing words are merged:
        self.assertIn("टीकाकरण", extracted)
        self.assertIn("जबलपुर", extracted)

        # 3. Duplicate variations are dropped:
        self.assertNotIn("बाल COPALCHILDREN'S NEURO CLINIC", extracted)
        self.assertNotIn("COPAL LCHILDREN'S NEVRO CLINIC", extracted)
        self.assertNotIn("िदवसृ", extracted)

        # 4. Misread phone 9989590477 is suppressed:
        self.assertNotIn("9989590477", extracted)
        self.assertNotIn("8447095305", extracted)

    def test_corrupt_image_returns_empty_top7_and_empty_text(self):
        import tempfile
        import os
        corrupt_file = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        corrupt_file.write(b"CORRUPTED_NON_IMAGE_DATA_BYTES")
        corrupt_file.close()

        try:
            result = process_post.process_post({"image_path": corrupt_file.name})
            self.assertEqual(result["ocr_text"], "")
            self.assertFalse(result["ocr_reliable"])
            self.assertEqual(result["top7_used"], [])
            self.assertEqual(result["ocr_blocks_total"], 0)
            self.assertEqual(result["ocr_blocks_excluded_low_confidence"], 0)
        finally:
            if os.path.exists(corrupt_file.name):
                os.unlink(corrupt_file.name)


if __name__ == "__main__":
    unittest.main()

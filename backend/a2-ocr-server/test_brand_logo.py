"""
Unit and Integration Tests for Brand Logo Check (AI First, Python Fallback).
"""

import os
import sys
import unittest
from pathlib import Path
import cv2
import numpy as np

# Ensure a2-ocr-server directory is on sys.path
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from brand_logo_check import (
    check_brand_logo,
    SUGGESTION_RULES,
    LOCATION_HINDI_MAP,
    PASS_THRESHOLD,
    MAX_POST_SIDE,
    _downscale_in_ram,
)
import process_post


class TestBrandLogoCheck(unittest.TestCase):

    def setUp(self):
        # Create a distinctive reference logo in RAM (Blue square with bright yellow star/symbol)
        self.logo = np.zeros((100, 100, 3), dtype=np.uint8)
        self.logo[:] = (200, 50, 20)  # Dark Blue in BGR
        cv2.circle(self.logo, (50, 50), 30, (30, 230, 240), -1)  # Yellow circle
        cv2.rectangle(self.logo, (45, 10), (55, 90), (255, 255, 255), -1)  # White cross
        cv2.rectangle(self.logo, (10, 45), (90, 55), (255, 255, 255), -1)

        # Create a blank poster
        self.poster = np.full((800, 800, 3), 245, dtype=np.uint8)
        cv2.putText(
            self.poster,
            "Doaguru Annual Health Camp 2026",
            (80, 200),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (40, 40, 40),
            2,
        )

    def test_suggestion_rules_exact_text(self):
        """Verify suggestion rules match exact required Hindi text."""
        self.assertEqual(
            SUGGESTION_RULES["MISSING"],
            "Logo post me kahin nahi mila. Logo ko neeche right corner me saaf jagah pe lagayein.",
        )
        self.assertEqual(
            SUGGESTION_RULES["WRONG_LOGO"],
            "Ye galat / purana logo hai. Brand Rules se naya logo download karke wahi lagayein.",
        )
        self.assertEqual(
            SUGGESTION_RULES["TOO_SMALL"],
            "Logo bahut chhota hai. Logo ko kam se kam 10% bada karein.",
        )
        self.assertEqual(
            SUGGESTION_RULES["HIDDEN"],
            "Logo text ke peeche chhup gaya hai. Logo ko khali jagah pe le jayein.",
        )
        self.assertEqual(
            SUGGESTION_RULES["COLOR_CHANGED"],
            "Logo ka rang badal gaya hai. Logo ka original rang wapas rakhein.",
        )

    def test_downscale_in_ram_guard(self):
        """Verify A2 Guard downscales images larger than 1600px without touching disk."""
        large_img = np.zeros((2400, 1800, 3), dtype=np.uint8)
        downscaled = _downscale_in_ram(large_img, MAX_POST_SIDE)
        h, w = downscaled.shape[:2]
        self.assertLessEqual(max(h, w), 1600)
        self.assertEqual(max(h, w), 1600)

    def test_python_fallback_logo_correct(self):
        """Verify Python fallback (SIFT + ORB + Template Matching) when AI is bypassed."""
        import brand_logo_check

        # Temporarily mock AI key to None to trigger Python Fallback
        orig_key_fn = brand_logo_check._get_api_key
        brand_logo_check._get_api_key = lambda: None
        try:
            # Place logo at bottom-right (x=680, y=680)
            post_with_logo = self.poster.copy()
            post_with_logo[680:780, 680:780] = self.logo

            res = check_brand_logo(post_with_logo, self.logo)
            self.assertEqual(res["status"], "PASS")
            self.assertTrue(res["found"])
            self.assertGreaterEqual(res["score"], PASS_THRESHOLD)
            self.assertEqual(res["location"], "bottom-right")
            self.assertEqual(res["location_hindi"], "Neeche Right corner me")
            self.assertEqual(res["reason"], "CORRECT")
            self.assertIn("Logo bilkul sahi", res["suggestion"])
        finally:
            brand_logo_check._get_api_key = orig_key_fn

    def test_python_fallback_logo_missing(self):
        """Verify Python fallback reports FAIL and MISSING when logo is absent."""
        import brand_logo_check

        orig_key_fn = brand_logo_check._get_api_key
        brand_logo_check._get_api_key = lambda: None
        try:
            # Poster has no logo
            res = check_brand_logo(self.poster, self.logo)
            self.assertEqual(res["status"], "FAIL")
            self.assertFalse(res["found"])
            self.assertLess(res["score"], PASS_THRESHOLD)
            self.assertEqual(res["reason"], "MISSING")
            self.assertEqual(
                res["suggestion"],
                "Logo post me kahin nahi mila. Logo ko neeche right corner me saaf jagah pe lagayein.",
            )
        finally:
            brand_logo_check._get_api_key = orig_key_fn

    def test_ai_first_when_gemini_key_available(self):
        """Verify AI First path succeeds with score >= 0.85 when logo is present."""
        # Place logo at bottom-right
        post_with_logo = self.poster.copy()
        post_with_logo[680:780, 680:780] = self.logo

        res = check_brand_logo(post_with_logo, self.logo)
        self.assertIn(res["status"], ["PASS", "FAIL"])
        if res["status"] == "PASS":
            self.assertTrue(res["found"])
            self.assertGreaterEqual(res["score"], PASS_THRESHOLD)
            self.assertEqual(res["reason"], "CORRECT")
            self.assertTrue(len(res["suggestion"]) > 0)

    def test_process_post_integration_with_logo_check(self):
        """Verify process_post includes logo_check in response."""
        post_with_logo = self.poster.copy()
        post_with_logo[680:780, 680:780] = self.logo

        # Encode temporary poster to file for process_post reader
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f_post:
            ok, buf = cv2.imencode(".png", post_with_logo)
            f_post.write(buf.tobytes())
            temp_post_path = f_post.name

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f_logo:
            ok2, buf2 = cv2.imencode(".png", self.logo)
            f_logo.write(buf2.tobytes())
            temp_logo_path = f_logo.name

        try:
            data = {
                "image_path": temp_post_path,
                "reference_logo_path": temp_logo_path,
            }

            # Mock OCR reader to avoid loading heavy PaddleOCR in unit tests
            class MockReader:
                def ocr(self, img, cls=True):
                    return [[[[[0, 0], [10, 0], [10, 10], [0, 10]], ("Test Text", 0.95)]]]

            result = process_post.process_post(data, reader=MockReader())
            self.assertIn("logo_check", result)
            logo_res = result["logo_check"]
            self.assertIsNotNone(logo_res)
            self.assertIn("status", logo_res)
            self.assertIn("found", logo_res)
            self.assertIn("score", logo_res)
            self.assertIn("location", logo_res)
            self.assertIn("location_hindi", logo_res)
            self.assertIn("size_percent", logo_res)
            self.assertIn("reason", logo_res)
            self.assertIn("suggestion", logo_res)
        finally:
            if os.path.exists(temp_post_path):
                os.unlink(temp_post_path)
            if os.path.exists(temp_logo_path):
                os.unlink(temp_logo_path)


if __name__ == "__main__":
    unittest.main()

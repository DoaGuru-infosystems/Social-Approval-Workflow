"""
Unit & Integration Tests for A2 Hosting Pure WSGI PaddleOCR Server.
Tests all endpoints, security controls, size limits, format validation,
temporary file lifecycles, and PaddleOCR output parsing without requiring
local PaddleOCR, PaddlePaddle, or PyTorch execution.
"""

import base64
import io
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

# Ensure a2-ocr-server is in sys.path
SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import app
import process_post

# Minimal valid 1x1 pixel image fixtures
# 1x1 JPEG bytes starting with \xff\xd8\xff
VALID_JPEG_BYTES = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00"
    b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
    b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
    b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\xff"
    b"\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f"
    b"\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08"
    b"\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9"
)

# 1x1 PNG bytes starting with \x89PNG\r\n\x1a\n
VALID_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?"
    b"\x03\x00\x08\xfc\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82"
)


class MockHunspellDict:
    """Mock dictionary implementing Hunspell lookup and suggest interface."""

    def __init__(self, correct_words=None):
        self.correct_words = {w.casefold() for w in (correct_words or [])}

    def lookup(self, word):
        return word.casefold() in self.correct_words

    def suggest(self, word):
        return [f"fix_{word}"]


def make_mock_dictionaries():
    return (
        MockHunspellDict(["apex", "health", "wellness", "workshop", "good", "consult", "physician", "before", "starting"]),
        None,
        MockHunspellDict(["नमस्ते", "स्वास्थ्य", "कार्यशाला"]),
    )


def make_wsgi_request(wsgi_app, method="GET", path="/", headers=None, body=b""):
    """
    Simulates a standard PEP 3333 WSGI request and returns (status_code, headers, parsed_json_or_text).
    """
    headers = headers or {}
    env = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "SCRIPT_NAME": "",
        "SERVER_NAME": "siarasystems.com",
        "SERVER_PORT": "443",
        "wsgi.version": (1, 0),
        "wsgi.url_scheme": "https",
        "wsgi.input": io.BytesIO(body),
        "wsgi.errors": io.StringIO(),
        "wsgi.multithread": False,
        "wsgi.multiprocess": False,
        "wsgi.run_once": False,
        "CONTENT_LENGTH": str(len(body)),
    }
    for k, v in headers.items():
        if k.lower() == "content-type":
            env["CONTENT_TYPE"] = v
        elif k.lower() == "content-length":
            env["CONTENT_LENGTH"] = v
        else:
            wsgi_key = "HTTP_" + k.upper().replace("-", "_")
            env[wsgi_key] = v

    resp_status = None
    resp_headers = {}

    def start_response(status_str, header_tuples):
        nonlocal resp_status, resp_headers
        resp_status = int(status_str.split()[0])
        resp_headers = dict(header_tuples)

    result_iterable = wsgi_app(env, start_response)
    raw_body = b"".join(result_iterable)

    try:
        parsed_body = json.loads(raw_body.decode("utf-8"))
    except Exception:
        parsed_body = raw_body.decode("utf-8")

    return resp_status, resp_headers, parsed_body


class TestA2OcrServer(unittest.TestCase):
    def setUp(self):
        self.app = app.application
        self.test_api_key = "test_secret_a2_key_xyz_123"
        os.environ["A2_OCR_API_KEY"] = self.test_api_key

    def tearDown(self):
        if "A2_OCR_API_KEY" in os.environ:
            del os.environ["A2_OCR_API_KEY"]

    # 1. Health Endpoint Tests
    def test_health_endpoint_direct(self):
        status, headers, body = make_wsgi_request(self.app, method="GET", path="/health")
        self.assertEqual(status, 200)
        self.assertEqual(body.get("status"), "ok")
        self.assertEqual(body.get("service"), "A2 Hosting PaddleOCR API")
        self.assertEqual(body.get("engine"), "PaddleOCR (Hindi/English) + Hunspell (spylls)")

    def test_health_root_path(self):
        status, headers, body = make_wsgi_request(self.app, method="GET", path="/")
        self.assertEqual(status, 200)
        self.assertEqual(body.get("status"), "ok")

    def test_health_mount_path_ocr_test(self):
        # Simulates Passenger delivering /ocr-test or /ocr-test/health
        status, headers, body = make_wsgi_request(self.app, method="GET", path="/ocr-test/health")
        self.assertEqual(status, 200)
        self.assertEqual(body.get("status"), "ok")

        status2, headers2, body2 = make_wsgi_request(self.app, method="GET", path="/ocr-test")
        self.assertEqual(status2, 200)
        self.assertEqual(body2.get("status"), "ok")

    def test_health_method_not_allowed(self):
        status, headers, body = make_wsgi_request(self.app, method="POST", path="/health")
        self.assertEqual(status, 405)
        self.assertIn("error", body)

    def test_unknown_endpoint_returns_404(self):
        status, headers, body = make_wsgi_request(self.app, method="GET", path="/random-endpoint")
        self.assertEqual(status, 404)
        self.assertIn("error", body)

    # 2. Authentication Tests for /check-post
    def test_check_post_missing_api_key(self):
        payload = json.dumps({"title": "Test"}).encode("utf-8")
        status, headers, body = make_wsgi_request(
            self.app,
            method="POST",
            path="/check-post",
            headers={"Content-Type": "application/json"},
            body=payload,
        )
        self.assertEqual(status, 401)
        self.assertIn("Unauthorized", body.get("error", ""))

    def test_check_post_invalid_api_key(self):
        payload = json.dumps({"title": "Test"}).encode("utf-8")
        status, headers, body = make_wsgi_request(
            self.app,
            method="POST",
            path="/check-post",
            headers={"Content-Type": "application/json", "X-API-Key": "wrong_key"},
            body=payload,
        )
        self.assertEqual(status, 401)
        self.assertIn("Unauthorized", body.get("error", ""))

    def test_check_post_server_missing_env_key(self):
        del os.environ["A2_OCR_API_KEY"]
        payload = json.dumps({"title": "Test"}).encode("utf-8")
        status, headers, body = make_wsgi_request(
            self.app,
            method="POST",
            path="/check-post",
            headers={"Content-Type": "application/json", "X-API-Key": "any_key"},
            body=payload,
        )
        self.assertEqual(status, 500)
        self.assertIn("A2_OCR_API_KEY is not configured", body.get("error", ""))

    # 3. Payload & Validation Tests
    def test_malformed_json_body(self):
        status, headers, body = make_wsgi_request(
            self.app,
            method="POST",
            path="/check-post",
            headers={"Content-Type": "application/json", "X-API-Key": self.test_api_key},
            body=b"not valid {json here",
        )
        self.assertEqual(status, 400)
        self.assertIn("Malformed JSON", body.get("error", ""))

    def test_json_payload_not_dict(self):
        status, headers, body = make_wsgi_request(
            self.app,
            method="POST",
            path="/check-post",
            headers={"Content-Type": "application/json", "X-API-Key": self.test_api_key},
            body=b'["a", "list", "not", "object"]',
        )
        self.assertEqual(status, 400)
        self.assertIn("JSON object", body.get("error", ""))

    def test_arbitrary_server_image_path_rejected(self):
        payload = json.dumps(
            {"title": "Test", "image_path": "/etc/passwd"}
        ).encode("utf-8")
        status, headers, body = make_wsgi_request(
            self.app,
            method="POST",
            path="/check-post",
            headers={"Content-Type": "application/json", "X-API-Key": self.test_api_key},
            body=payload,
        )
        self.assertEqual(status, 400)
        self.assertIn("Client cannot specify server image_path", body.get("error", ""))

    def test_invalid_base64_data(self):
        payload = json.dumps(
            {"title": "Test", "image_base64": "!!!not_valid_base64@@@"}
        ).encode("utf-8")
        status, headers, body = make_wsgi_request(
            self.app,
            method="POST",
            path="/check-post",
            headers={"Content-Type": "application/json", "X-API-Key": self.test_api_key},
            body=payload,
        )
        self.assertEqual(status, 400)
        self.assertIn("Invalid Base64", body.get("error", ""))

    def test_unsupported_image_format(self):
        text_b64 = base64.b64encode(b"This is just plain text, not an image.").decode("ascii")
        payload = json.dumps({"title": "Test", "image_base64": text_b64}).encode("utf-8")
        status, headers, body = make_wsgi_request(
            self.app,
            method="POST",
            path="/check-post",
            headers={"Content-Type": "application/json", "X-API-Key": self.test_api_key},
            body=payload,
        )
        self.assertEqual(status, 400)
        self.assertIn("Only JPEG and PNG", body.get("error", ""))

    def test_oversized_image_limit(self):
        big_image = VALID_PNG_BYTES + (b"\x00" * (10 * 1024 * 1024 + 100))
        big_b64 = base64.b64encode(big_image).decode("ascii")
        payload = json.dumps({"title": "Test", "image_base64": big_b64}).encode("utf-8")
        status, headers, body = make_wsgi_request(
            self.app,
            method="POST",
            path="/check-post",
            headers={"Content-Type": "application/json", "X-API-Key": self.test_api_key},
            body=payload,
        )
        self.assertEqual(status, 400)
        self.assertIn("exceeds maximum limit of 10 MB", body.get("error", ""))

    # 4. Processing Lifecycle & Temporary File Tests (with Mocked ML layers)
    @patch("app.get_cached_dictionaries", return_value=(None, None, None))
    @patch("app.get_cached_reader", return_value=None)
    @patch("process_post.process_post")
    def test_check_post_without_image(self, mock_process_post, mock_reader, mock_dicts):
        mock_process_post.return_value = {
            "ocr_text": "",
            "ocr_reliable": False,
            "ocr_confidence_avg": 0.0,
            "spelling_issues": [],
            "ocr_issues": [],
            "banned_words_found": [],
            "missing_mandatory_phrases": [],
        }

        payload = json.dumps(
            {
                "title": "Healthy Routine",
                "caption": "Consult physician before starting #ApexHealth",
                "whitelist_words": ["ApexHealth"],
                "banned_words": ["cure-all"],
                "mandatory_phrases": ["#ApexHealth"],
            }
        ).encode("utf-8")

        status, headers, body = make_wsgi_request(
            self.app,
            method="POST",
            path="/check-post",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.test_api_key}",
            },
            body=payload,
        )

        self.assertEqual(status, 200)
        self.assertEqual(body.get("ocr_text"), "")
        self.assertFalse(body.get("ocr_reliable"))
        self.assertEqual(body.get("spelling_issues"), [])
        self.assertEqual(body.get("missing_mandatory_phrases"), [])

        mock_process_post.assert_called_once()
        passed_data = mock_process_post.call_args[0][0]
        self.assertIsNone(passed_data.get("image_path"))
        self.assertEqual(passed_data.get("title"), "Healthy Routine")

    @patch("app.get_cached_dictionaries", return_value=(None, None, None))
    @patch("app.get_cached_reader", return_value=MagicMock())
    @patch("process_post.process_post")
    def test_check_post_with_jpeg_image_lifecycle(self, mock_process_post, mock_reader, mock_dicts):
        captured_temp_path = None

        def fake_process(data, reader=None, dictionaries=None):
            nonlocal captured_temp_path
            captured_temp_path = data.get("image_path")
            if not captured_temp_path or not os.path.exists(captured_temp_path):
                raise AssertionError(f"Expected temporary file to exist at {captured_temp_path}")
            return {
                "ocr_text": "APEX HEALTH",
                "ocr_reliable": True,
                "ocr_confidence_avg": 0.94,
                "spelling_issues": [],
                "ocr_issues": [],
                "banned_words_found": [],
                "missing_mandatory_phrases": [],
            }

        mock_process_post.side_effect = fake_process

        jpeg_b64 = base64.b64encode(VALID_JPEG_BYTES).decode("ascii")
        payload = json.dumps(
            {
                "title": "Poster Test",
                "caption": "Stay active",
                "image_base64": jpeg_b64,
                "image_filename": "poster.jpg",
                "whitelist_words": ["APEX"],
                "banned_words": [],
                "mandatory_phrases": [],
            }
        ).encode("utf-8")

        status, headers, body = make_wsgi_request(
            self.app,
            method="POST",
            path="/ocr-test/check-post",
            headers={"Content-Type": "application/json", "X-API-Key": self.test_api_key},
            body=payload,
        )

        self.assertEqual(status, 200)
        self.assertEqual(body.get("ocr_text"), "APEX HEALTH")
        self.assertTrue(body.get("ocr_reliable"))
        self.assertEqual(body.get("ocr_confidence_avg"), 0.94)

        # Check timings breakdown object
        self.assertIn("timings", body)
        timings = body["timings"]
        self.assertIn("total_ms", timings)
        self.assertIn("base64_decode_ms", timings)
        self.assertIn("temp_file_create_ms", timings)
        self.assertIn("reader_cached", timings)
        self.assertIn("reader_init_ms", timings)
        self.assertIn("ocr_inference_ms", timings)
        self.assertIn("dictionaries_cached", timings)
        self.assertIn("dictionaries_init_ms", timings)
        self.assertIn("spelling_validation_ms", timings)
        self.assertIn("worker_pid", timings)
        self.assertIn("worker_requests_served", timings)
        self.assertGreaterEqual(timings["worker_requests_served"], 1)

        # Crucial check: verify temporary file was cleanly deleted in finally block
        self.assertIsNotNone(captured_temp_path)
        self.assertFalse(
            os.path.exists(captured_temp_path),
            f"Temporary file {captured_temp_path} was NOT deleted after request completion!",
        )

    @patch("app.get_cached_dictionaries", return_value=(None, None, None))
    @patch("app.get_cached_reader", return_value=MagicMock())
    @patch("process_post.process_post")
    def test_check_post_temp_file_deleted_even_on_exception(self, mock_process_post, mock_reader, mock_dicts):
        captured_temp_path = None

        def crash_process(data, reader=None, dictionaries=None):
            nonlocal captured_temp_path
            captured_temp_path = data.get("image_path")
            raise RuntimeError("Simulated internal ML exception during OCR")

        mock_process_post.side_effect = crash_process

        png_b64 = base64.b64encode(VALID_PNG_BYTES).decode("ascii")
        payload = json.dumps(
            {"title": "Crash Test", "image_base64": f"data:image/png;base64,{png_b64}"}
        ).encode("utf-8")

        status, headers, body = make_wsgi_request(
            self.app,
            method="POST",
            path="/check-post",
            headers={"Content-Type": "application/json", "X-API-Key": self.test_api_key},
            body=payload,
        )

        self.assertEqual(status, 500)
        self.assertIn("error", body)
        self.assertIsNotNone(captured_temp_path)
        self.assertFalse(
            os.path.exists(captured_temp_path),
            "Temporary file remained on disk after processing failure!",
        )

    # 5. Environment Variables Verification
    def test_thread_and_paddle_environment_configured(self):
        expected_vars = [
            "OPENBLAS_NUM_THREADS",
            "OMP_NUM_THREADS",
            "MKL_NUM_THREADS",
            "NUMEXPR_NUM_THREADS",
            "OPENCV_NUM_THREADS",
            "VECLIB_MAXIMUM_THREADS",
            "BLIS_NUM_THREADS",
            "CPU_NUM",
        ]
        for var in expected_vars:
            self.assertEqual(
                os.environ.get(var),
                "1",
                f"Thread limit {var} is not set to 1 in server environment",
            )
        self.assertEqual(os.environ.get("FLAGS_fraction_of_cpu_memory_to_use"), "0.5")
        self.assertEqual(os.environ.get("PADDLE_DISABLE_TELEMETRY"), "1")


class TestPaddleOCRProcessing(unittest.TestCase):
    """
    Direct tests for PaddleOCR result parsing, Hindi, English, confidence
    and compliance validation in process_post.py.
    """

    def setUp(self):
        self.dictionaries = make_mock_dictionaries()
        # Create a real dummy image file for resolved_image_path check
        import tempfile
        self.temp_img = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        self.temp_img.write(VALID_PNG_BYTES)
        self.temp_img.close()
        self.img_path = self.temp_img.name

    def tearDown(self):
        if os.path.exists(self.img_path):
            os.unlink(self.img_path)

    def test_paddleocr_english_text_extraction(self):
        # Mock PaddleOCR return format:
        # [ [ [box_points, (text, confidence)], ... ] ]
        mock_reader = MagicMock()
        mock_reader.ocr.return_value = [
            [
                [[[10, 10], [100, 10], [100, 30], [10, 30]], ("APEX HEALTH", 0.965)],
                [[[10, 40], [120, 40], [120, 60], [10, 60]], ("WELLNESS WORKSHOP", 0.923)],
            ]
        ]

        result = process_post.process_post(
            {
                "image_path": self.img_path,
                "title": "Healthy Living",
                "caption": "Join us today",
                "whitelist_words": ["APEX"],
                "banned_words": [],
                "mandatory_phrases": [],
            },
            reader=mock_reader,
            dictionaries=self.dictionaries,
        )

        self.assertEqual(result["ocr_text"], "APEX HEALTH\nWELLNESS WORKSHOP")
        self.assertTrue(result["ocr_reliable"])
        self.assertAlmostEqual(result["ocr_confidence_avg"], 0.944, places=3)
        self.assertIn("ocr_inference_ms", result["_internal_timings"])
        self.assertIn("spelling_validation_ms", result["_internal_timings"])

    def test_paddleocr_hindi_text_extraction(self):
        mock_reader = MagicMock()
        mock_reader.ocr.return_value = [
            [
                [[[10, 10], [100, 10], [100, 30], [10, 30]], ("नमस्ते", 0.971)],
                [[[10, 40], [120, 40], [120, 60], [10, 60]], ("स्वास्थ्य", 0.954)],
            ]
        ]

        result = process_post.process_post(
            {
                "image_path": self.img_path,
                "title": "Hindi Post",
                "caption": "Hindi caption",
                "whitelist_words": [],
                "banned_words": [],
                "mandatory_phrases": [],
            },
            reader=mock_reader,
            dictionaries=self.dictionaries,
        )

        self.assertEqual(result["ocr_text"], "नमस्ते\nस्वास्थ्य")
        self.assertTrue(result["ocr_reliable"])
        self.assertAlmostEqual(result["ocr_confidence_avg"], 0.9625, places=3)

    def test_paddleocr_mixed_hindi_english_numeric(self):
        mock_reader = MagicMock()
        mock_reader.ocr.return_value = [
            [
                [[[10, 10], [100, 10], [100, 30], [10, 30]], ("नमस्ते Apex 2026", 0.915)],
            ]
        ]

        result = process_post.process_post(
            {
                "image_path": self.img_path,
                "title": "Mixed",
                "caption": "Mixed",
                "whitelist_words": ["Apex"],
                "banned_words": [],
                "mandatory_phrases": [],
            },
            reader=mock_reader,
            dictionaries=self.dictionaries,
        )

        self.assertEqual(result["ocr_text"], "नमस्ते Apex 2026")
        self.assertTrue(result["ocr_reliable"])

    def test_paddleocr_low_confidence_marks_unreliable(self):
        mock_reader = MagicMock()
        mock_reader.ocr.return_value = [
            [
                [[[10, 10], [100, 10], [100, 30], [10, 30]], ("scam cure-all", 0.35)],
            ]
        ]

        result = process_post.process_post(
            {
                "image_path": self.img_path,
                "title": "Good Post",
                "caption": "Good post caption",
                "whitelist_words": [],
                "banned_words": ["cure-all", "scam"],
                "mandatory_phrases": [],
            },
            reader=mock_reader,
            dictionaries=self.dictionaries,
        )

        self.assertEqual(result["ocr_text"], "scam cure-all")
        self.assertFalse(result["ocr_reliable"])
        self.assertEqual(result["ocr_confidence_avg"], 0.35)
        # Banned words from OCR text should NOT be flagged when OCR is unreliable
        self.assertEqual(result["banned_words_found"], [])
        self.assertEqual(result["ocr_issues"], [])

    def test_paddleocr_banned_words_flagged_when_reliable(self):
        mock_reader = MagicMock()
        mock_reader.ocr.return_value = [
            [
                [[[10, 10], [100, 10], [100, 30], [10, 30]], ("guaranteed cure-all product", 0.88)],
            ]
        ]

        result = process_post.process_post(
            {
                "image_path": self.img_path,
                "title": "Apex Post",
                "caption": "Stay healthy",
                "whitelist_words": [],
                "banned_words": ["cure-all", "guaranteed"],
                "mandatory_phrases": [],
            },
            reader=mock_reader,
            dictionaries=self.dictionaries,
        )

        self.assertTrue(result["ocr_reliable"])
        self.assertIn("cure-all", result["banned_words_found"])
        self.assertIn("guaranteed", result["banned_words_found"])

    def test_paddleocr_empty_and_none_results(self):
        mock_reader = MagicMock()
        # Test various representations of empty PaddleOCR results
        empty_cases = [None, [], [None], [[]]]

        for case in empty_cases:
            mock_reader.ocr.return_value = case
            result = process_post.process_post(
                {
                    "image_path": self.img_path,
                    "title": "Empty Test",
                    "caption": "Caption",
                    "whitelist_words": [],
                    "banned_words": [],
                    "mandatory_phrases": [],
                },
                reader=mock_reader,
                dictionaries=self.dictionaries,
            )
            self.assertEqual(result["ocr_text"], "")
            self.assertFalse(result["ocr_reliable"])
            self.assertEqual(result["ocr_confidence_avg"], 0.0)

    def test_paddleocr_handles_nan_and_irregular_confidences(self):
        mock_reader = MagicMock()
        # Test NaN, Inf, and out-of-range confidence scores
        mock_reader.ocr.return_value = [
            [
                [[[0, 0]], ("Line One", float("nan"))],
                [[[0, 0]], ("Line Two", float("inf"))],
                [[[0, 0]], ("Line Three", 1.8)],
                [[[0, 0]], ("Line Four", -0.5)],
                [[[0, 0]], ("Line Five", "not_a_number")],
            ]
        ]

        result = process_post.process_post(
            {
                "image_path": self.img_path,
                "title": "Conf Test",
                "caption": "Caption",
                "whitelist_words": [],
                "banned_words": [],
                "mandatory_phrases": [],
            },
            reader=mock_reader,
            dictionaries=self.dictionaries,
        )

        self.assertIn("Line One", result["ocr_text"])
        import math
        self.assertTrue(math.isfinite(result["ocr_confidence_avg"]))
        self.assertGreaterEqual(result["ocr_confidence_avg"], 0.0)
        self.assertLessEqual(result["ocr_confidence_avg"], 1.0)
        # Ensure json serialization succeeds without error
        json_output = json.dumps(result)
        self.assertNotIn("NaN", json_output)
        self.assertNotIn("Infinity", json_output)

    def test_paddleocr_handles_multipage_and_irregular_lines(self):
        mock_reader = MagicMock()
        # Simulates multi-page detections with irregular/corrupt entries
        mock_reader.ocr.return_value = [
            [
                None,
                [],
                [[[0, 0]], ("Page 1 Line 1", 0.95)],
                "not_a_line",
            ],
            None,
            [
                [[[0, 0]], ("Page 2 Line 1", 0.91)],
                [[[0, 0]], ("", 0.99)],  # Empty text should be ignored
            ]
        ]

        result = process_post.process_post(
            {
                "image_path": self.img_path,
                "title": "Multipage Test",
                "caption": "Caption",
                "whitelist_words": [],
                "banned_words": [],
                "mandatory_phrases": [],
            },
            reader=mock_reader,
            dictionaries=self.dictionaries,
        )

        self.assertEqual(result["ocr_text"], "Page 1 Line 1\nPage 2 Line 1")
        self.assertTrue(result["ocr_reliable"])
        self.assertAlmostEqual(result["ocr_confidence_avg"], 0.93, places=2)

    def test_load_reader_paddleocr_configuration(self):
        fake_paddle_cls = MagicMock()
        fake_module = SimpleNamespace(PaddleOCR=fake_paddle_cls)

        with patch.dict(sys.modules, {"paddleocr": fake_module}):
            reader = process_post.load_reader()

        fake_paddle_cls.assert_called_once_with(
            use_angle_cls=True,
            lang="hi",
            use_gpu=False,
            show_log=False,
            enable_mkldnn=False,
            cpu_threads=1,
        )


if __name__ == "__main__":
    unittest.main()

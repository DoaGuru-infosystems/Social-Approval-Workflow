"""
Pure Python WSGI application for A2 Hosting PaddleOCR & Brand Check Service.
Compatible with Python 3.11+ on cPanel / CloudLinux Passenger WSGI.
Does not require Flask, FastAPI, or Django.
"""

import base64
import hmac
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

# 1. Enforce strict single-thread environment before importing heavy ML/imaging packages
THREAD_ENV = (
    "OPENBLAS_NUM_THREADS",
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "OPENCV_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
    "BLIS_NUM_THREADS",
    "CPU_NUM",
)
for variable in THREAD_ENV:
    os.environ[variable] = "1"

os.environ["FLAGS_fraction_of_cpu_memory_to_use"] = "0.5"
os.environ["PADDLE_DISABLE_TELEMETRY"] = "1"

# Ensure HOME directory points to user directory on A2 Hosting if unset under Passenger
if "HOME" not in os.environ or not os.environ.get("HOME"):
    if os.path.exists("/home/siarasys"):
        os.environ["HOME"] = "/home/siarasys"

# 2. Add local directory and A2 virtualenv site-packages to sys.path if not present
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

A2_VENV_SITE_PACKAGES = "/home/siarasys/virtualenv/ocr-test/3.11/lib/python3.11/site-packages"
if os.path.exists(A2_VENV_SITE_PACKAGES) and A2_VENV_SITE_PACKAGES not in sys.path:
    sys.path.insert(0, A2_VENV_SITE_PACKAGES)

import process_post

# 3. Maximum limits
MAX_REQUEST_BYTES = 16 * 1024 * 1024   # 16 MB HTTP request body
MAX_IMAGE_BYTES = 10 * 1024 * 1024     # 10 MB decoded image binary

# 4. In-memory model singleton (Thread-safe caching)
_MODEL_LOCK = threading.Lock()
_CACHED_READER = None
_WORKER_LOCK = threading.Lock()
_WORKER_REQUESTS = 0


def get_cached_reader():
    """Returns the persistent PaddleOCR Reader singleton."""
    global _CACHED_READER
    if _CACHED_READER is None:
        with _MODEL_LOCK:
            if _CACHED_READER is None:
                _CACHED_READER = process_post.load_reader()
    return _CACHED_READER


def try_prewarm_models():
    """Optional pre-warming called at WSGI startup; ignores failures until first request."""
    try:
        get_cached_reader()
        print("[A2-OCR] PaddleOCR Reader successfully pre-warmed.", file=sys.stderr)
    except Exception as exc:
        print(f"[A2-OCR] Pre-warming notice: Deferred to first request ({exc}).", file=sys.stderr)


def json_response(start_response, status_code, data):
    """Formats and sends a standard JSON HTTP response."""
    status_map = {
        200: "200 OK",
        400: "400 Bad Request",
        401: "401 Unauthorized",
        404: "404 Not Found",
        405: "405 Method Not Allowed",
        413: "413 Payload Too Large",
        500: "500 Internal Server Error",
    }
    status = status_map.get(status_code, f"{status_code} Status")
    payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
    headers = [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Content-Length", str(len(payload))),
        ("Cache-Control", "no-store, no-cache, must-revalidate"),
    ]
    start_response(status, headers)
    return [payload]


def resolve_route(environ):
    """
    Normalizes request path for Passenger WSGI mounted under /ocr-test or root.
    Handles PATH_INFO, SCRIPT_NAME, and REQUEST_URI variations.
    """
    path_info = (environ.get("PATH_INFO") or "").strip()
    request_uri = (environ.get("REQUEST_URI") or "").strip()

    # Strip query strings
    if "?" in path_info:
        path_info = path_info.split("?", 1)[0].strip()
    if "?" in request_uri:
        request_uri = request_uri.split("?", 1)[0].strip()

    # Choose raw path candidate
    raw = path_info
    if not raw or raw == "/":
        if request_uri and request_uri != "/":
            raw = request_uri

    # Strip /ocr-test mount prefix if present
    if raw.startswith("/ocr-test/"):
        raw = raw[len("/ocr-test"):]
    elif raw == "/ocr-test":
        raw = "/"

    # Normalize trailing slashes
    if len(raw) > 1 and raw.endswith("/"):
        raw = raw[:-1]

    if not raw.startswith("/"):
        raw = "/" + raw

    return raw


def get_client_api_key(environ):
    """Extracts API key from X-API-Key, Authorization: Bearer, or Api-Key headers."""
    key = environ.get("HTTP_X_API_KEY")
    if key:
        return key.strip()

    auth = environ.get("HTTP_AUTHORIZATION", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()

    key = environ.get("HTTP_API_KEY")
    if key:
        return key.strip()

    return None


def verify_authorization(environ):
    """
    Validates the caller's API key against A2_OCR_API_KEY environment variable.
    Uses constant-time comparison to prevent timing attacks.
    """
    expected_key = os.environ.get("A2_OCR_API_KEY", "").strip()
    if not expected_key:
        return False, "SERVER_KEY_NOT_CONFIGURED"

    provided_key = get_client_api_key(environ)
    if not provided_key:
        return False, "MISSING_KEY"

    if not hmac.compare_digest(provided_key, expected_key):
        return False, "INVALID_KEY"

    return True, None


def handle_health(environ, start_response):
    """GET /health: Service health check and cache status."""
    if environ.get("REQUEST_METHOD", "GET") != "GET":
        return json_response(start_response, 405, {"error": "Method not allowed. Use GET for /health."})

    return json_response(
        start_response,
        200,
        {
            "status": "ok",
            "service": "A2 Hosting PaddleOCR API",
            "version": "1.1.0",
            "engine": "PaddleOCR (Hindi/English)",
            "models_cached": _CACHED_READER is not None,
            "worker_pid": os.getpid(),
            "worker_requests_served": _WORKER_REQUESTS,
        },
    )


def handle_check_post(environ, start_response):
    """POST /check-post: Authenticated OCR and brand compliance check."""
    request_start_time = time.perf_counter()
    with _WORKER_LOCK:
        global _WORKER_REQUESTS
        _WORKER_REQUESTS += 1
        current_request_num = _WORKER_REQUESTS

    if environ.get("REQUEST_METHOD", "") != "POST":
        return json_response(start_response, 405, {"error": "Method not allowed. Use POST for /check-post."})

    # 1. API Key Authentication
    is_auth, auth_err = verify_authorization(environ)
    if not is_auth:
        if auth_err == "SERVER_KEY_NOT_CONFIGURED":
            return json_response(
                start_response,
                500,
                {"error": "Server configuration error: A2_OCR_API_KEY is not configured on the server."},
            )
        return json_response(
            start_response,
            401,
            {"error": "Unauthorized: Missing or invalid API key."},
        )

    # 2. Content-Length check
    try:
        content_length = int(environ.get("CONTENT_LENGTH", 0))
    except (ValueError, TypeError):
        return json_response(start_response, 400, {"error": "Invalid Content-Length header."})

    if content_length <= 0:
        return json_response(start_response, 400, {"error": "Empty request body."})

    if content_length > MAX_REQUEST_BYTES:
        return json_response(
            start_response,
            413,
            {"error": f"Payload Too Large: Request exceeds maximum allowed size of {MAX_REQUEST_BYTES // (1024*1024)} MB."},
        )

    # 3. Read Body
    try:
        body = environ["wsgi.input"].read(content_length)
    except Exception as exc:
        return json_response(start_response, 400, {"error": f"Failed to read request body: {str(exc)}"})

    if len(body) != content_length:
        return json_response(start_response, 400, {"error": "Incomplete request body received."})

    # 4. Parse JSON
    try:
        data = json.loads(body.decode("utf-8"))
    except Exception:
        return json_response(start_response, 400, {"error": "Malformed JSON in request body."})

    if not isinstance(data, dict):
        return json_response(start_response, 400, {"error": "Request body must be a JSON object."})

    # 5. Security check: Reject arbitrary server filesystem paths
    if "image_path" in data and data["image_path"]:
        return json_response(
            start_response,
            400,
            {"error": "Client cannot specify server image_path. Provide image_base64 instead."},
        )

    # 6. Extract fields
    title = data.get("title", "")
    caption = data.get("caption", "")
    image_base64 = data.get("image_base64")
    per_block_confidence_threshold = data.get("per_block_confidence_threshold")
    expected_phones = data.get("expected_phones", [])
    whitelist_words = data.get("whitelist_words", [])
    reference_logo_path = data.get("reference_logo_path")
    reference_logo_base64 = data.get("reference_logo_base64")
    reference_logo = data.get("reference_logo")

    # 7. Validate & Decode Image if provided
    temp_image_path = None
    base64_decode_ms = 0.0
    temp_file_create_ms = 0.0

    if image_base64 is not None:
        if not isinstance(image_base64, str):
            return json_response(start_response, 400, {"error": "image_base64 must be a string."})

        cleaned_base64 = image_base64.strip()
        if cleaned_base64:
            # Strip data URI prefix if present (e.g., 'data:image/jpeg;base64,...')
            if "," in cleaned_base64 and cleaned_base64.startswith("data:"):
                cleaned_base64 = cleaned_base64.split(",", 1)[1]

            try:
                t0 = time.perf_counter()
                image_bytes = base64.b64decode(cleaned_base64, validate=True)
                base64_decode_ms = (time.perf_counter() - t0) * 1000
            except Exception:
                return json_response(start_response, 400, {"error": "Invalid Base64 encoded image data."})

            if len(image_bytes) == 0:
                return json_response(start_response, 400, {"error": "Decoded image data is empty."})

            if len(image_bytes) > MAX_IMAGE_BYTES:
                return json_response(
                    start_response,
                    400,
                    {"error": f"Image size exceeds maximum limit of {MAX_IMAGE_BYTES // (1024*1024)} MB."},
                )

            # Inspect magic bytes for supported formats (JPEG and PNG)
            if image_bytes.startswith(b"\xff\xd8\xff"):
                extension = ".jpg"
            elif image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
                extension = ".png"
            else:
                return json_response(
                    start_response,
                    400,
                    {"error": "Unsupported image format. Only JPEG and PNG images are supported."},
                )

            # Write to secure temporary file
            try:
                t0 = time.perf_counter()
                temp_file = tempfile.NamedTemporaryFile(suffix=extension, delete=False)
                temp_file.write(image_bytes)
                temp_file.flush()
                temp_file.close()
                temp_image_path = temp_file.name
                temp_file_create_ms = (time.perf_counter() - t0) * 1000
            except Exception as exc:
                return json_response(start_response, 500, {"error": "Failed to create secure temporary image file."})

    # 8. Execute OCR Processing (guarantee temporary file deletion in finally block)
    try:
        reader_cached = _CACHED_READER is not None
        reader_init_ms = 0.0
        if temp_image_path:
            t0 = time.perf_counter()
            reader = get_cached_reader()
            reader_init_ms = (time.perf_counter() - t0) * 1000 if not reader_cached else 0.0
        else:
            reader = None

        post_input = {
            "title": title,
            "caption": caption,
            "image_path": temp_image_path,
            "per_block_confidence_threshold": per_block_confidence_threshold,
            "expected_phones": expected_phones,
            "whitelist_words": whitelist_words,
            "reference_logo_path": reference_logo_path,
            "reference_logo_base64": reference_logo_base64,
            "reference_logo": reference_logo,
        }

        result = process_post.process_post(post_input, reader=reader)

        # Extract engine timings and attach comprehensive performance metrics
        internal_timings = result.pop("_internal_timings", {})
        ocr_inference_ms = internal_timings.get("ocr_inference_ms", 0.0)
        total_ms = (time.perf_counter() - request_start_time) * 1000

        result["timings"] = {
            "total_ms": round(total_ms, 2),
            "base64_decode_ms": round(base64_decode_ms, 2),
            "temp_file_create_ms": round(temp_file_create_ms, 2),
            "reader_cached": reader_cached,
            "reader_init_ms": round(reader_init_ms, 2),
            "ocr_inference_ms": round(ocr_inference_ms, 2),
            "worker_pid": os.getpid(),
            "worker_requests_served": current_request_num,
        }

        return json_response(start_response, 200, result)

    except Exception as exc:
        print(f"[A2-OCR ERROR] Processing failure: {exc}", file=sys.stderr)
        # Never expose internal traceback or server paths to client
        return json_response(
            start_response,
            500,
            {"error": "OCR quality check processing failed on server.", "ocr_reliable": False},
        )
    finally:
        if temp_image_path and os.path.exists(temp_image_path):
            try:
                os.unlink(temp_image_path)
            except Exception:
                pass


def application(environ, start_response):
    """
    Main WSGI entry point called by Phusion Passenger.
    """
    route = resolve_route(environ)

    if route in ("/", "/health"):
        return handle_health(environ, start_response)
    elif route == "/check-post":
        return handle_check_post(environ, start_response)
    else:
        return json_response(
            start_response,
            404,
            {
                "error": "Endpoint not found.",
                "requested_route": route,
                "available_endpoints": ["GET /health", "POST /check-post"],
            },
        )

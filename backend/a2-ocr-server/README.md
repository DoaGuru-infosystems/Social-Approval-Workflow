# A2 Hosting Python PaddleOCR & Brand Check API Server

Pure Python WSGI application configured for A2 Hosting (cPanel / CloudLinux with Phusion Passenger).

- **Application URL**: `https://siarasystems.com/ocr-test`
- **Application Root**: `/home/siarasys/ocr-test`
- **Python Version**: `3.11.18`
- **Virtual Environment**: `/home/siarasys/virtualenv/ocr-test/3.11`
- **Startup File**: `passenger_wsgi.py`
- **WSGI Entry Point**: `application`
- **OCR Engine**: PaddleOCR (Hindi / Devanagari + English + Numerics)

---

## 1. Deployment Bundle Structure

Upload all files in this directory directly into `/home/siarasys/ocr-test/`:

```
/home/siarasys/ocr-test/
├── passenger_wsgi.py          # Passenger WSGI entry point (exposes application)
├── app.py                     # Pure standard-library WSGI router, auth & validation
├── process_post.py            # Bilingual PaddleOCR, Hunspell & brand compliance engine
├── prepare_models.py          # Pre-downloads PaddleOCR model weights into ~/.paddleocr/
├── requirements.txt           # Virtual environment dependencies
├── test_server.py             # Automated unit & integration tests
└── dictionaries/
    └── hi_IN/
        ├── hi_IN.aff          # Hindi Hunspell affix file
        ├── hi_IN.dic          # Hindi Hunspell dictionary (207,695 root words)
        ├── COPYING
        ├── Copyright
        └── SOURCE.txt
```

---

## 2. Required A2 Environment Variables

Set the following environment variables in cPanel under **Setup Python App** (or in the application `.env` / environment section):

| Variable | Required | Value / Description | Example |
|---|---|---|---|
| `A2_OCR_API_KEY` | **Yes** | Shared secret key for authenticating API requests. Must match the key used in local Node.js backend. | `a2_ocr_sec_99a8b7c6d5e4f3a2b1` |
| `CPU_NUM` | Set automatically by script | Enforces single-thread execution for PaddlePaddle CPU. | `1` |
| `OPENBLAS_NUM_THREADS` | Set automatically by script | Enforces single-thread execution for linear algebra. | `1` |
| `OMP_NUM_THREADS` | Set automatically by script | Enforces single-thread execution for OpenMP. | `1` |
| `MKL_NUM_THREADS` | Set automatically by script | Enforces single-thread execution for MKL. | `1` |
| `OPENCV_NUM_THREADS` | Set automatically by script | Prevents OpenCV thread pool creation. | `1` |
| `FLAGS_fraction_of_cpu_memory_to_use` | Set automatically by script | Limits PaddlePaddle CPU memory allocation. | `0.5` |
| `PADDLE_DISABLE_TELEMETRY` | Set automatically by script | Silences telemetry network calls. | `1` |

> [!IMPORTANT]
> The single-thread and memory limit environment variables are hardcoded at the very top of `passenger_wsgi.py`, `app.py`, and `prepare_models.py` before any imports of PaddleOCR, PaddlePaddle, or OpenCV. This prevents A2 CloudLinux NPROC and virtual memory limit exhaustion.

---

## 3. Step-by-Step cPanel Deployment Instructions

### Step 3.1: Configure the Python Application in cPanel
1. Log in to cPanel on A2 Hosting (`siarasystems.com`).
2. Navigate to **Software** → **Setup Python App**.
3. Verify application settings:
   - **Python version**: `3.11.18` (or 3.11.x)
   - **Application root**: `ocr-test` (resolves to `/home/siarasys/ocr-test`)
   - **Application URL**: `ocr-test` (resolves to `https://siarasystems.com/ocr-test`)
   - **Application startup file**: `passenger_wsgi.py`
   - **Application Entry point**: `application`
4. Under **Environment variables**, ensure `A2_OCR_API_KEY` is set:
   - Name: `A2_OCR_API_KEY`
   - Value: `<YOUR_SECURE_API_KEY>`
5. Click **Save**.

### Step 3.2: Upload Server Files
Upload the updated contents of `backend/a2-ocr-server/` into `/home/siarasys/ocr-test/` via cPanel File Manager or SFTP:
- `requirements.txt`
- `process_post.py`
- `prepare_models.py`
- `passenger_wsgi.py`
- `app.py`
- `test_server.py`
- `README.md`
- `dictionaries/` (if not already uploaded)

### Step 3.3: Install Dependencies & Pre-warm Models via Terminal (SSH)
Connect via SSH to your A2 Hosting account:
```bash
# 1. Activate the Python 3.11 virtual environment
source /home/siarasys/virtualenv/ocr-test/3.11/bin/activate

# 2. Change to application directory
cd /home/siarasys/ocr-test

# 3. Upgrade pip and install PaddleOCR and dependencies
pip install --upgrade pip
# Pre-install headless OpenCV to ensure pip does not pull GUI-dependent opencv-python
pip install "opencv-python-headless>=4.8.0,<4.11.0"
pip install -r requirements.txt

# 4. Pre-download PaddleOCR Hindi & English detection, recognition, and angle classifier models
# This downloads model weights into ~/.paddleocr/ so the first HTTP request doesn't time out
python prepare_models.py

# 5. Run internal verification tests
python test_server.py
```

### Step 3.4: Restart the Python Application
1. In cPanel **Setup Python App**, click **Restart** on the `ocr-test` application.
2. Alternatively, via SSH:
   ```bash
   mkdir -p /home/siarasys/ocr-test/tmp
   touch /home/siarasys/ocr-test/tmp/restart.txt
   ```

### Step 3.5: Verify from Local Machine
Run the remote OCR test script from your local development project:
```bash
node backend/test-remote-ocr.js backend/uploads/post-1794641616395-780099445.jpeg
```

---

## 4. API Specification & Examples

### 4.1. Health Check Endpoint
* **Method**: `GET`
* **URL**: `https://siarasystems.com/ocr-test/health` (or `https://siarasystems.com/ocr-test/`)
* **Authentication**: None (public health monitor)

#### Request:
```bash
curl -X GET "https://siarasystems.com/ocr-test/health"
```

#### Response (200 OK):
```json
{
  "status": "ok",
  "service": "A2 Hosting PaddleOCR API",
  "version": "1.0.0",
  "engine": "PaddleOCR (Hindi/English) + Hunspell (spylls)",
  "models_cached": true,
  "dictionaries_cached": true,
  "worker_pid": 12345,
  "worker_requests_served": 1
}
```

---

### 4.2. OCR & Brand Compliance Check Endpoint
* **Method**: `POST`
* **URL**: `https://siarasystems.com/ocr-test/check-post`
* **Authentication**: Required (`X-API-Key: <key>` or `Authorization: Bearer <key>`)
* **Headers**:
  * `Content-Type: application/json`
  * `X-API-Key: <A2_OCR_API_KEY>`

#### Request Payload:
```json
{
  "title": "Wellness Workshop",
  "caption": "Join us for morning wellness. Consult physician before starting #ApexHealth",
  "image_base64": "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/...",
  "image_filename": "poster.jpg",
  "whitelist_words": ["Apex", "ApexHealth", "FitFam", "नमस्ते"],
  "banned_words": ["guaranteed", "cure-all", "scam"],
  "mandatory_phrases": ["#ApexHealth"]
}
```

#### Successful Response (200 OK):
```json
{
  "ocr_text": "APEX HEALTH\nWELLNESS WORKSHOP",
  "ocr_reliable": true,
  "ocr_confidence_avg": 0.9412,
  "spelling_issues": [],
  "ocr_issues": [],
  "banned_words_found": [],
  "missing_mandatory_phrases": [],
  "timings": {
    "total_ms": 1250.5,
    "base64_decode_ms": 12.3,
    "temp_file_create_ms": 2.1,
    "reader_cached": true,
    "reader_init_ms": 0.0,
    "ocr_inference_ms": 1180.2,
    "dictionaries_cached": true,
    "dictionaries_init_ms": 0.0,
    "spelling_validation_ms": 15.4,
    "worker_pid": 12345,
    "worker_requests_served": 5
  }
}
```

#### Flagged Response Example (200 OK with issues):
```json
{
  "ocr_text": "APEX HEALLTH\nCURE-ALL PRODUCT",
  "ocr_reliable": true,
  "ocr_confidence_avg": 0.892,
  "spelling_issues": [
    {
      "word": "heallth",
      "script": "english",
      "suggestions": ["health", "healthy"]
    }
  ],
  "ocr_issues": [
    {
      "word": "heallth",
      "script": "english",
      "suggestions": ["health", "healthy"]
    }
  ],
  "banned_words_found": ["cure-all"],
  "missing_mandatory_phrases": ["#ApexHealth"]
}
```

#### Error Responses:
* **401 Unauthorized**:
  ```json
  {"error": "Unauthorized: Missing or invalid API key."}
  ```
* **400 Bad Request (Image Size Exceeded)**:
  ```json
  {"error": "Image size exceeds maximum limit of 10 MB."}
  ```
* **400 Bad Request (Unsupported Format)**:
  ```json
  {"error": "Unsupported image format. Only JPEG and PNG images are supported."}
  ```
* **400 Bad Request (Path Injection Attempt)**:
  ```json
  {"error": "Client cannot specify server image_path. Provide image_base64 instead."}
  ```
* **413 Payload Too Large**:
  ```json
  {"error": "Payload Too Large: Request exceeds maximum allowed size of 16 MB."}
  ```

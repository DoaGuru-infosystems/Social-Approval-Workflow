"""
Passenger WSGI Startup File for A2 Hosting Python Application.
Configured in cPanel "Setup Python App":
  - Application Root: /home/siarasys/ocr-test
  - Startup File: passenger_wsgi.py
  - Entry Point: application
"""

import os
import sys

# 1. Enforce strict single-thread environment variables before any library load
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

# 2. Add Virtual Environment and Application Root to Python sys.path
VENV_PATH = "/home/siarasys/virtualenv/ocr-test/3.11"
if os.path.exists(VENV_PATH):
    site_packages = os.path.join(VENV_PATH, "lib", "python3.11", "site-packages")
    if os.path.exists(site_packages) and site_packages not in sys.path:
        sys.path.insert(0, site_packages)

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

# 3. Import WSGI application entry point
from app import application, try_prewarm_models

# 4. Attempt model pre-warming during worker process boot
try_prewarm_models()

import os


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

import sys
from contextlib import redirect_stdout


def main():
    print("Pre-downloading PaddleOCR Hindi and English models...", file=sys.stderr)
    with redirect_stdout(sys.stderr):
        import numpy as np
        from paddleocr import PaddleOCR

        reader = PaddleOCR(
            use_angle_cls=True,
            lang="hi",
            use_gpu=False,
            show_log=False,
            enable_mkldnn=False,
            cpu_threads=1,
        )
        # Execute synthetic warm-up inference to verify graph compilation and weight extraction
        dummy_image = np.zeros((32, 32, 3), dtype=np.uint8)
        reader.ocr(dummy_image, cls=True)

    print("PaddleOCR Hindi and English models are ready and verified.")


if __name__ == "__main__":
    main()

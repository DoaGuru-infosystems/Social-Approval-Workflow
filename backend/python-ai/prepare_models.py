import os


THREAD_ENV = (
    "OPENBLAS_NUM_THREADS",
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "OPENCV_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
    "BLIS_NUM_THREADS",
)
for variable in THREAD_ENV:
    os.environ[variable] = "1"


import sys
from contextlib import redirect_stdout


def main():
    with redirect_stdout(sys.stderr):
        import cv2

        cv2.setNumThreads(1)
        import torch

        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
        import easyocr

        easyocr.Reader(["en", "hi"])
    print("EasyOCR English and Hindi models are ready.")


if __name__ == "__main__":
    main()

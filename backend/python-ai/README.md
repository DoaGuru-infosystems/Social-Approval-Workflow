# Python AI checker

The backend starts one Python process per AI check. It does not run Flask or a persistent Python service.

From the `backend` directory, create the virtual environment and install dependencies:

```powershell
python -m venv python-ai/venv
.\python-ai\venv\Scripts\python.exe -m pip install -r python-ai/requirements.txt
.\python-ai\venv\Scripts\python.exe .\python-ai\prepare_models.py
```

On Linux, use `python3 -m venv python-ai/venv`, then run `python-ai/venv/bin/python -m pip install -r python-ai/requirements.txt` and `python-ai/venv/bin/python python-ai/prepare_models.py`.

Run `npm run migrate-python-ai` once for databases that already have an `ai_check_results` table, then `npm run test-ai` to test the simple Hindi image and the sample poster. The model preparation step downloads the EasyOCR models before requests use the 30-second process timeout.

The Python scripts and Node child-process environment constrain OpenCV, PyTorch, and numerical-library thread pools to one thread to reduce worker-thread exhaustion on shared hosting.

`process_post.py` accepts `image_path`, `caption`, `title`, `whitelist_words`, `banned_words`, and `mandatory_phrases` as one JSON object on standard input. It returns OCR text/reliability/confidence, spelling issues, banned words, and missing phrases as one JSON object on standard output. The minimum reliable OCR confidence is 0.5; unreliable OCR is excluded from spelling and banned-word checks.

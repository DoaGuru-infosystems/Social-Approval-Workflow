import sys
from pathlib import Path
from unittest.mock import MagicMock

# Mock cv2, numpy, paddleocr if not installed in current python environment
for mod in ["cv2", "numpy", "paddleocr"]:
    if mod not in sys.modules:
        sys.modules[mod] = MagicMock()

# Add backend/a2-ocr-server to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "a2-ocr-server"))

from process_post import (
    analyze_hindi_word,
    apply_hindi_confusion_rules,
    get_confusion_rules,
    get_hindi_matra_rules,
    get_hindi_word_frequency,
)

def test_rules():
    print("Testing dynamic rules loading...")
    rules = get_confusion_rules()
    assert len(rules) > 0, "Confusion rules should not be empty"
    print(f"Loaded {len(rules)} dynamic confusion rules.")

    matras = get_hindi_matra_rules()
    assert "matras" in matras, "Matra rules should contain 'matras'"
    print(f"Loaded matra rules for {len(matras['matras'])} matras.")

    freq = get_hindi_word_frequency()
    assert len(freq) >= 500, f"Frequency dict should have >= 500 words, got {len(freq)}"
    print(f"Loaded frequency dict with {len(freq)} words.")

    print("\nTesting analyze_hindi_word...")
    a1 = analyze_hindi_word("नःशुलक")
    print("Analysis for 'नःशुलक':", a1)
    assert not a1["is_valid"], "'नःशुलक' should be flagged as invalid"
    assert "निःशुल्क" in a1["candidates"], "'निःशुल्क' should be a candidate"

    a_eng = analyze_hindi_word("DOCTOR")
    assert a_eng["is_valid"], "Pure English should be valid"

    print("\nTesting apply_hindi_confusion_rules...")
    corrections = []
    
    # 1. Matra / Visarga / Halant error
    t1 = apply_hindi_confusion_rules("नःशुलक", corrections)
    assert t1 == "निःशुल्क", f"Expected 'निःशुल्क', got '{t1}'"
    assert any(c["original"] == "नःशुलक" and c["corrected"] == "निःशुल्क" and c["error_type"] == "OCR_ERROR" for c in corrections), "Should record OCR_ERROR"
    print("Test 1 Passed: 'नःशुलक' -> 'निःशुल्क' (OCR_ERROR)")

    # 2. Spurious Anusvara
    corrections.clear()
    t2 = apply_hindi_confusion_rules("सुंबह", corrections)
    assert t2 == "सुबह", f"Expected 'सुबह', got '{t2}'"
    assert any(c["original"] == "सुंबह" and c["corrected"] == "सुबह" and c["error_type"] == "OCR_ERROR" for c in corrections), "Should record OCR_ERROR"
    print("Test 2 Passed: 'सुंबह' -> 'सुबह' (OCR_ERROR)")

    # 3. Pure English gating (Critical Rule 6.4)
    corrections.clear()
    eng_text = "NAVJYOTI EYE HOSPITAL OPD CLINIC"
    t3 = apply_hindi_confusion_rules(eng_text, corrections)
    assert t3 == eng_text, f"English text must be 100% untouched: got '{t3}'"
    assert len(corrections) == 0, "No corrections should be applied to English"
    print("Test 3 Passed: English text completely untouched")

    # 4. Mixed Hindi + English
    corrections.clear()
    mixed_text = "NAVJYOTI निःशुल्क नेत्र शिविर"
    t4 = apply_hindi_confusion_rules(mixed_text, corrections)
    assert t4 == mixed_text, f"Expected '{mixed_text}', got '{t4}'"
    print("Test 4 Passed: Mixed text processed cleanly without corrupting English or Hindi")

    # 5. Halant split conjunct repair
    corrections.clear()
    t5 = apply_hindi_confusion_rules("क् ष", corrections)
    assert t5 == "क्ष", f"Expected 'क्ष', got '{t5}'"
    print("Test 5 Passed: 'क् ष' -> 'क्ष' halant conjunct repair")

    print("\nALL PYTHON RULE TESTS PASSED!")

if __name__ == "__main__":
    test_rules()

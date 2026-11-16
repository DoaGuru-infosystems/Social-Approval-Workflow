/**
 * Extensible ruleset for fixing common OCR recognition misclassifications.
 * Each rule defines a pattern, replacement, and description.
 */
const OCR_CORRECTION_RULES = [
  // 1. In digit sequences / phone numbers, replace letters O, o, Q with digit 0
  {
    name: 'numeric_o_q_to_zero',
    apply: (text) => {
      let current = text;
      let prev = '';
      // Loop to handle consecutive occurrences like "898O59O477"
      while (current !== prev) {
        prev = current;
        current = current.replace(/(\d)[OoQ](\d)/g, '$10$2');
      }
      // Also handle terminal O/o/Q at end of long digit sequence (e.g. "492723O")
      current = current.replace(/(\b\d{4,})[OoQ]\b/g, '$10');
      return current;
    },
  },
  // 2. In digit sequences, replace letters I, l, | with digit 1 (e.g. "898|590477")
  {
    name: 'numeric_i_l_to_one',
    apply: (text) => {
      let current = text;
      let prev = '';
      while (current !== prev) {
        prev = current;
        current = current.replace(/(\d)[Il|](\d)/g, '$11$2');
      }
      return current;
    },
  },
  // 3. In digit sequences, replace letter B with digit 8 (e.g. "0761-492723B")
  {
    name: 'numeric_b_to_eight',
    apply: (text) => {
      let current = text;
      let prev = '';
      while (current !== prev) {
        prev = current;
        current = current.replace(/(\d)[B](\d)/g, '$18$2');
      }
      return current;
    },
  },
  // 4. In digit sequences, replace letters S, s with digit 5 (e.g. "8989s90477")
  {
    name: 'numeric_s_to_five',
    apply: (text) => {
      let current = text;
      let prev = '';
      while (current !== prev) {
        prev = current;
        current = current.replace(/(\d)[Ss](\d)/g, '$15$2');
      }
      return current;
    },
  },
  // 5. Clean common whitespace noise around hyphens in phone numbers: "0761 - 4927230" -> "0761-4927230"
  {
    name: 'normalize_phone_hyphens',
    apply: (text) => text.replace(/(\d+)\s*-\s*(\d+)/g, '$1-$2'),
  },
];

/**
 * Apply common OCR error corrections to extracted text.
 * @param {string} text
 * @param {Array<string>} [expectedPhones=[]]
 * @returns {string} Cleaned and corrected text
 */
const fixCommonOcrErrors = (text, expectedPhones = []) => {
  if (!text || typeof text !== 'string') {
    return text || '';
  }

  let result = text;
  for (const rule of OCR_CORRECTION_RULES) {
    try {
      result = rule.apply(result);
    } catch (err) {
      console.warn(`[TextCorrectionService] Error in rule '${rule.name}':`, err.message);
    }
  }

  return result;
};

module.exports = {
  fixCommonOcrErrors,
  OCR_CORRECTION_RULES,
};

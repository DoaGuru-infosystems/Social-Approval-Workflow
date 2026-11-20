const fs = require('fs');
const path = require('path');

const CONSONANTS = [
  'क', 'ख', 'ग', 'घ', 'ङ',
  'च', 'छ', 'ज', 'झ', 'ञ',
  'ट', 'ठ', 'ड', 'ढ', 'ण',
  'त', 'थ', 'द', 'ध', 'न',
  'प', 'फ', 'ब', 'भ', 'म',
  'य', 'र', 'ल', 'व',
  'श', 'ष', 'स', 'ह',
  'क्ष', 'त्र', 'ज्ञ',
  // Common extended consonants
  'श्र', 'ड़', 'ढ़', 'फ़', 'ज़'
];

const MATRAS = [
  { symbol: '', vowel: 'अ', roman: 'a', name: 'mukta' },
  { symbol: 'ा', vowel: 'आ', roman: 'aa', name: 'aakaar' },
  { symbol: 'ि', vowel: 'इ', roman: 'i', name: 'chhoti_i' },
  { symbol: 'ी', vowel: 'ई', roman: 'ee', name: 'badi_i' },
  { symbol: 'ु', vowel: 'उ', roman: 'u', name: 'chhota_u' },
  { symbol: 'ू', vowel: 'ऊ', roman: 'oo', name: 'bada_u' },
  { symbol: 'े', vowel: 'ए', roman: 'e', name: 'ekaar' },
  { symbol: 'ै', vowel: 'ऐ', roman: 'ai', name: 'aikaar' },
  { symbol: 'ो', vowel: 'ओ', roman: 'o', name: 'okaar' },
  { symbol: 'ौ', vowel: 'औ', roman: 'au', name: 'aukaar' },
  { symbol: 'ं', vowel: 'अं', roman: 'am', name: 'anusvara' },
  { symbol: 'ः', vowel: 'अः', roman: 'ah', name: 'visarga' },
];

const INDEPENDENT_VOWELS = [
  'अ', 'आ', 'इ', 'ई', 'उ', 'ऊ', 'ए', 'ऐ', 'ओ', 'औ', 'अं', 'अः', 'ऋ', 'ऑ', 'ऍ'
];

const barakhadiTable = {};
const validSyllablesSet = new Set(INDEPENDENT_VOWELS);

for (const c of CONSONANTS) {
  barakhadiTable[c] = [];
  for (const m of MATRAS) {
    const syllable = c + m.symbol;
    barakhadiTable[c].push({
      syllable,
      consonant: c,
      matra: m.symbol,
      vowel_sound: m.vowel,
      roman: m.roman,
    });
    validSyllablesSet.add(syllable);
  }
}

const barakhadiData = {
  description: "Hindi Barakhadi (बारहखड़ी) 36 consonants x 12 matras structural validation dictionary",
  total_consonants: CONSONANTS.length,
  total_matras: MATRAS.length,
  consonants: CONSONANTS,
  matras: MATRAS,
  independent_vowels: INDEPENDENT_VOWELS,
  barakhadi_table: barakhadiTable,
  valid_syllables: Array.from(validSyllablesSet),
};

const outPath = path.resolve(__dirname, '..', 'dictionaries', 'hindi_barakhadi.json');
fs.writeFileSync(outPath, JSON.stringify(barakhadiData, null, 2), 'utf8');
console.log(`Generated hindi_barakhadi.json with ${validSyllablesSet.size} valid syllables at ${outPath}`);

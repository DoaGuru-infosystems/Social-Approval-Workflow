const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Get 32-byte cipher key from ENCRYPTION_KEY or hashed JWT_SECRET
 */
const getKey = () => {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey && envKey.length === 64) {
    return Buffer.from(envKey, 'hex');
  }
  const secret = process.env.JWT_SECRET || 'default_secret_key_change_me_in_production';
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypt a plaintext token string
 * @param {string} text
 * @returns {string} iv:tag:encryptedHex
 */
const encrypt = (text) => {
  if (!text) return '';
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
};

/**
 * Decrypt an encrypted token string
 * @param {string} cipherText iv:tag:encryptedHex
 * @returns {string} plaintext
 */
const decrypt = (cipherText) => {
  if (!cipherText || !cipherText.includes(':')) return '';
  const [ivHex, tagHex, encryptedHex] = cipherText.split(':');
  if (!ivHex || !tagHex || !encryptedHex) return '';

  try {
    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.warn('[Encryption] Decryption failed:', err.message);
    return '';
  }
};

module.exports = {
  encrypt,
  decrypt,
};


import { encrypt, decrypt } from '../../src/utils/crypto';

const KEY = '0'.repeat(64); // 32 bytes of zeros, hex-encoded

describe('crypto', () => {
  test('round-trip: decrypt(encrypt(text)) === text', () => {
    const plaintext = 'super-secret-token-abc123';
    const cipher = encrypt(plaintext, KEY);
    expect(decrypt(cipher, KEY)).toBe(plaintext);
  });

  test('two encryptions of same input produce different ciphertexts (random IV)', () => {
    const plaintext = 'same-input';
    const cipher1 = encrypt(plaintext, KEY);
    const cipher2 = encrypt(plaintext, KEY);
    expect(cipher1).not.toBe(cipher2);
  });

  test('decrypting with wrong key throws', () => {
    const cipher = encrypt('hello', KEY);
    const wrongKey = '1'.repeat(64);
    expect(() => decrypt(cipher, wrongKey)).toThrow();
  });

  test('tampered ciphertext throws', () => {
    const cipher = encrypt('hello', KEY);
    const parts = cipher.split(':');
    // Flip last char of data segment
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('a') ? 'b' : 'a');
    expect(() => decrypt(parts.join(':'), KEY)).toThrow();
  });

  test('tampered auth tag throws', () => {
    const cipher = encrypt('hello', KEY);
    const parts = cipher.split(':');
    parts[1] = parts[1].slice(0, -1) + (parts[1].endsWith('a') ? 'b' : 'a');
    expect(() => decrypt(parts.join(':'), KEY)).toThrow();
  });

  test('invalid format throws', () => {
    expect(() => decrypt('not-valid', KEY)).toThrow('Invalid cipher format');
  });
});

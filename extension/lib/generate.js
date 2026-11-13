const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const LOCAL_PART_LENGTH = 10;
// Largest multiple of the alphabet size that fits in a byte; bytes at or above it would bias `% 36`.
const ACCEPT_BELOW = 256 - (256 % ALPHABET.length);

export function cryptoRandomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomLocalPart(randomBytes = cryptoRandomBytes) {
  let out = "";
  while (out.length < LOCAL_PART_LENGTH) {
    for (const byte of randomBytes(LOCAL_PART_LENGTH)) {
      if (byte >= ACCEPT_BELOW) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === LOCAL_PART_LENGTH) break;
    }
  }
  return out;
}

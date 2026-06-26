import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

function deriveKey(key: string): Buffer {
  return createHash('sha256').update(key, 'utf8').digest(); // 32 octets
}

/** Chiffre un plaintext en `iv.authTag.ciphertext` (chaque segment en base64). */
export function encryptSession(plaintext: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, deriveKey(key), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

/** Déchiffre un payload produit par encryptSession. Lève si clé/payload invalides. */
export function decryptSession(payload: string, key: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Payload de session invalide');
  const decipher = createDecipheriv(ALGO, deriveKey(key), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

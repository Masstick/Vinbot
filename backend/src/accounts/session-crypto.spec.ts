import { encryptSession, decryptSession } from './session-crypto';

describe('session-crypto', () => {
  const key = 'clef-de-test-quelconque';

  it('chiffre puis déchiffre et retrouve le plaintext', () => {
    const plain = JSON.stringify({ cookies: [{ name: 'a', value: 'b' }] });
    const enc = encryptSession(plain, key);
    expect(enc).not.toContain('cookies'); // le ciphertext ne fuit pas le contenu
    expect(decryptSession(enc, key)).toBe(plain);
  });

  it('produit un ciphertext différent à chaque appel (IV aléatoire)', () => {
    expect(encryptSession('x', key)).not.toBe(encryptSession('x', key));
  });

  it('lève une erreur si la clé est mauvaise', () => {
    const enc = encryptSession('secret', key);
    expect(() => decryptSession(enc, 'mauvaise-clef')).toThrow();
  });
});

// backend/src/accounts/vinted-connect.spec.ts
import { isLoggedIn, buildSessionJson } from './vinted-connect.service';

describe('vinted-connect helpers', () => {
  it('isLoggedIn vrai si cookie access_token_web présent', () => {
    expect(isLoggedIn([{ name: 'access_token_web' }, { name: 'other' }])).toBe(true);
  });
  it('isLoggedIn vrai si cookie _vinted_fr_session présent', () => {
    expect(isLoggedIn([{ name: '_vinted_fr_session' }])).toBe(true);
  });
  it('isLoggedIn faux sans cookie d auth', () => {
    expect(isLoggedIn([{ name: 'cf_clearance' }])).toBe(false);
  });
  it('buildSessionJson produit un JSON parseable {cookies, origins}', () => {
    const json = buildSessionJson([{ name: 'a', value: 'b' }], [{ origin: 'https://www.vinted.fr', localStorage: [] }]);
    const parsed = JSON.parse(json);
    expect(parsed.cookies).toHaveLength(1);
    expect(parsed.origins[0].origin).toBe('https://www.vinted.fr');
  });
});

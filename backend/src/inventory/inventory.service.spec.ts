import { computeMargin } from './inventory.service';

describe('computeMargin', () => {
  it('renvoie la marge quand les deux prix existent', () => {
    expect(computeMargin(30, 10)).toBe(20);
  });
  it('renvoie null si prix d achat manquant', () => {
    expect(computeMargin(30, null)).toBeNull();
  });
  it('renvoie null si prix de vente manquant', () => {
    expect(computeMargin(null, 10)).toBeNull();
  });
  it('gère les décimales', () => {
    expect(computeMargin(25.5, 5.25)).toBeCloseTo(20.25, 2);
  });
});

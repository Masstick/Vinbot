import { truncatedMean } from './truncated-mean';

describe('truncatedMean', () => {
  it('retourne 0 pour un tableau vide', () => {
    expect(truncatedMean([])).toBe(0);
  });

  it('fait une moyenne simple quand il y a peu de valeurs (pas de troncature)', () => {
    expect(truncatedMean([10, 20, 30])).toBeCloseTo(20);
  });

  it('exclut les outliers hauts et bas sur un échantillon plus large', () => {
    // 10 valeurs : un outlier bas ("pour pièces" à 2€) et un outlier haut (200€)
    const prices = [2, 18, 19, 20, 20, 21, 22, 22, 23, 200];
    const result = truncatedMean(prices);
    // Sans troncature la moyenne serait tirée vers le haut par 200 ; avec troncature
    // (10% de chaque côté = 1 valeur retirée de chaque côté), 2 et 200 sont exclus.
    expect(result).toBeCloseTo((18 + 19 + 20 + 20 + 21 + 22 + 22 + 23) / 8);
  });
});

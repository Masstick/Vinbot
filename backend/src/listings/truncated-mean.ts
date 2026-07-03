/** Moyenne tronquée : retire les 10% de prix les plus hauts et les plus bas avant
 *  de moyenner, pour absorber les annonces "pour pièces"/cassées et les erreurs de
 *  classification isolées. En dessous de 10 valeurs, aucune troncature n'a lieu
 *  (10% arrondi à 0) : moyenne simple. */
export function truncatedMean(prices: number[]): number {
  if (prices.length === 0) return 0;
  const sorted = [...prices].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * 0.1);
  const trimmed = cut > 0 ? sorted.slice(cut, sorted.length - cut) : sorted;
  const effective = trimmed.length > 0 ? trimmed : sorted;
  return effective.reduce((sum, p) => sum + p, 0) / effective.length;
}

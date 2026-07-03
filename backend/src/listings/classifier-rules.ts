export interface ClassificationRule {
  family: string;
  familyPattern: RegExp;
  extract: (title: string) => string | null;
}

function extractCapacityGo(title: string): string | null {
  const m = title.match(/(\d+)\s?(?:go|gb)\b/i);
  return m ? `${m[1]}GB` : null;
}

function extractRamGeneration(title: string): string | null {
  const m = title.match(/ddr\s?([2-5])/i);
  return m ? `DDR${m[1]}` : null;
}

export const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    family: 'RAM',
    familyPattern: /\bddr[2-5]\b|\bso-?dimm\b/i,
    extract: title => {
      const gen = extractRamGeneration(title);
      const capacity = extractCapacityGo(title);
      if (!gen || !capacity) return null;
      return `RAM ${gen} ${capacity}`;
    },
  },
  {
    family: 'CPU',
    familyPattern: /\bi[3579][\s-]\d{3,5}[a-z]*\b|\bryzen\b|\bxeon\b/i,
    extract: title => {
      const m = title.match(/\bi([3579])[\s-](\d{3,5}[a-z]*)\b/i);
      if (!m) return null;
      return `CPU i${m[1]}-${m[2].toUpperCase()}`;
    },
  },
];

/** Applique les règles dans l'ordre ; la première qui reconnaît une famille ET
 *  parvient à en extraire une clé exploitable l'emporte. Retourne null si aucune
 *  règle ne matche ou si la famille est reconnue mais l'extraction échoue
 *  (ex: "RAM DDR3" sans capacité). */
export function classifyTitle(title: string): string | null {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.familyPattern.test(title)) {
      const key = rule.extract(title);
      if (key) return key;
    }
  }
  return null;
}

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

function extractGpuModel(title: string): string | null {
  const nvidia = title.match(/\b(rtx|gtx|gt)[\s-]?(\d{3,4})\s?(ti|super)?\b/i);
  if (nvidia) {
    const suffix = nvidia[3] ? ` ${nvidia[3][0].toUpperCase()}${nvidia[3].slice(1).toLowerCase()}` : '';
    return `${nvidia[1].toUpperCase()} ${nvidia[2]}${suffix}`;
  }
  const amd = title.match(/\b(rx|r9|r7|r5)[\s-]?(\d{3,4})\s?(xt)?\b/i);
  if (amd) {
    const suffix = amd[3] ? ' XT' : '';
    return `${amd[1].toUpperCase()} ${amd[2]}${suffix}`;
  }
  return null;
}

const MOTHERBOARD_CHIPSETS =
  /\b(z390|z490|z590|z690|z790|b360|b365|b450|b460|b550|b560|b650|b660|b760|h310|h370|h410|h510|h610|q370|x299|x370|x470|x570|x670|a320|a520|trx40)\b/i;

function extractMotherboardChipset(title: string): string | null {
  const m = title.match(MOTHERBOARD_CHIPSETS);
  return m ? m[1].toUpperCase() : null;
}

function extractStorageCapacity(title: string): string | null {
  const tb = title.match(/(\d+(?:[.,]\d+)?)\s?(?:to|tb)\b/i);
  if (tb) return `${tb[1].replace(',', '.')}TB`;
  const gb = title.match(/(\d+)\s?(?:go|gb)\b/i);
  return gb ? `${gb[1]}GB` : null;
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
  {
    family: 'GPU',
    familyPattern: /\b(rtx|gtx|gt|radeon|rx|r9|r7|r5)\b/i,
    extract: title => {
      const model = extractGpuModel(title);
      return model ? `GPU ${model}` : null;
    },
  },
  {
    family: 'Carte mère',
    familyPattern: /carte\s?m[eè]re|motherboard|\bmobo\b/i,
    extract: title => {
      const chipset = extractMotherboardChipset(title);
      return chipset ? `Carte mère ${chipset}` : null;
    },
  },
  {
    family: 'Stockage',
    familyPattern: /\bssd\b|\bhdd\b|\bnvme\b|disque\s?dur/i,
    extract: title => {
      const capacity = extractStorageCapacity(title);
      if (!capacity) return null;
      const type = /nvme/i.test(title) ? 'NVMe' : /\bssd\b/i.test(title) ? 'SSD' : 'HDD';
      return `${type} ${capacity}`;
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

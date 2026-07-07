export interface ItemDetails {
  description: string | null;
  photoUrls: string[];
}

/**
 * Le bloc JSON-LD (`<script type="application/ld+json">`) contient la description
 * complète en JSON simplement échappé (contrairement au payload RSC de la page,
 * qui la ré-échappe une seconde fois en tant que chaîne imbriquée et est donc plus
 * fragile à parser). Vérifié sur une vraie page d'annonce Vinted (2026-07-07).
 */
export function extractDescription(html: string): string | null {
  const m = html.match(/<script type="application\/ld\+json">(\{[^<]*\})<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    return typeof data.description === 'string' ? data.description : null;
  } catch {
    return null;
  }
}

/**
 * Les photos ne sont disponibles que dans le payload RSC, où chaque objet photo
 * est ré-échappé une fois (guillemets précédés d'un `\` littéral). On ancre sur
 * `,"is_main"` qui ne suit que l'URL pleine taille de chaque photo (jamais une
 * miniature du tableau `thumbnails`). Vérifié sur une vraie page d'annonce (2026-07-07).
 */
export function extractPhotoUrls(html: string): string[] {
  const urls = new Set<string>();
  const re = /\\"url\\":\\"(https:\/\/[a-z0-9.-]+\.vinted\.net\/[^"\\]+)\\",\\"is_main\\"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    urls.add(match[1]);
  }
  return Array.from(urls);
}

export function parseItemDetails(html: string): ItemDetails {
  return { description: extractDescription(html), photoUrls: extractPhotoUrls(html) };
}

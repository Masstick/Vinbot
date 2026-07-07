import { extractDescription, extractPhotoUrls, parseItemDetails } from './item-detail-parser';

// Extraits minimaux mais fidèles à la structure réelle observée sur une page
// d'annonce Vinted (vérifié manuellement le 2026-07-07) : le JSON-LD porte la
// description complète en JSON simplement échappé, et le payload RSC porte les
// photos en JSON ré-échappé (guillemets précédés d'un `\` littéral).
const LD_JSON_BLOCK =
  '<script type="application/ld+json">{"@type":"Product","name":"Blusa romántica t.l",' +
  '"description":"Es divina \\nMedidas \\nAxila 59cm","image":"https://images1.vinted.net/t/x/f800/1.webp",' +
  '"brand":{"@type":"Brand","name":""},"offers":{"@type":"Offer","price":12},"@context":"https://schema.org"}</script>';

const RSC_PHOTOS_BLOCK =
  '<script>self.__next_f.push([1,"...\\"photos\\":[' +
  '{\\"id\\":1,\\"image_no\\":1,\\"url\\":\\"https://images1.vinted.net/t/a/f800/1.webp?s=abc\\",\\"is_main\\":true,' +
  '\\"thumbnails\\":[{\\"type\\":\\"thumb70x100\\",\\"url\\":\\"https://images1.vinted.net/t/a/70x100/1.webp?s=abc\\"}]},' +
  '{\\"id\\":2,\\"image_no\\":2,\\"url\\":\\"https://images1.vinted.net/t/b/f800/2.webp?s=def\\",\\"is_main\\":false,' +
  '\\"thumbnails\\":[{\\"type\\":\\"thumb70x100\\",\\"url\\":\\"https://images1.vinted.net/t/b/70x100/2.webp?s=def\\"}]}' +
  ']..."])</script>';

const SAMPLE_HTML = `<html><head>${LD_JSON_BLOCK}</head><body>${RSC_PHOTOS_BLOCK}</body></html>`;

describe('extractDescription', () => {
  it('extrait la description complète depuis le bloc JSON-LD', () => {
    expect(extractDescription(SAMPLE_HTML)).toBe('Es divina \nMedidas \nAxila 59cm');
  });

  it('retourne null si aucun bloc JSON-LD de produit n’est présent', () => {
    expect(extractDescription('<html><body>rien ici</body></html>')).toBeNull();
  });
});

describe('extractPhotoUrls', () => {
  it('extrait les URLs pleine taille sans les miniatures, sans doublon', () => {
    expect(extractPhotoUrls(SAMPLE_HTML)).toEqual([
      'https://images1.vinted.net/t/a/f800/1.webp?s=abc',
      'https://images1.vinted.net/t/b/f800/2.webp?s=def',
    ]);
  });

  it('retourne un tableau vide si aucune photo n’est trouvée', () => {
    expect(extractPhotoUrls('<html><body>rien ici</body></html>')).toEqual([]);
  });
});

describe('parseItemDetails', () => {
  it('combine description et photos', () => {
    expect(parseItemDetails(SAMPLE_HTML)).toEqual({
      description: 'Es divina \nMedidas \nAxila 59cm',
      photoUrls: [
        'https://images1.vinted.net/t/a/f800/1.webp?s=abc',
        'https://images1.vinted.net/t/b/f800/2.webp?s=def',
      ],
    });
  });
});

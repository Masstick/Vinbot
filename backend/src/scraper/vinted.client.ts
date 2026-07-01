import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { Logger } from '@nestjs/common';
import { VintedItem } from '../listings/listings.service';

const SESSION_TTL_MS = 90 * 60 * 1000; // 90 minutes

// Rotation de User-Agent : on tire un UA réaliste à la création de chaque session
// (et à chaque reset après un 403). Vu de Vinted, le trafic ressemble à plusieurs
// navigateurs distincts plutôt qu'à un seul robot figé. Tous desktop pour rester
// cohérent avec les en-têtes Accept/Accept-Language envoyés.
const USER_AGENTS: string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export const COUNTRY_DOMAINS: Record<string, string> = {
  fr: 'https://www.vinted.fr',
  be: 'https://www.vinted.be',
  es: 'https://www.vinted.es',
  pl: 'https://www.vinted.pl',
  de: 'https://www.vinted.de',
  nl: 'https://www.vinted.nl',
  it: 'https://www.vinted.it',
  pt: 'https://www.vinted.pt',
  se: 'https://www.vinted.se',
  cz: 'https://www.vinted.cz',
  sk: 'https://www.vinted.sk',
  hu: 'https://www.vinted.hu',
  ro: 'https://www.vinted.ro',
  at: 'https://www.vinted.at',
  lu: 'https://www.vinted.lu',
  lt: 'https://www.vinted.lt',
  lv: 'https://www.vinted.lv',
  ee: 'https://www.vinted.ee',
  uk: 'https://www.vinted.co.uk',
};

export class VintedClient {
  private readonly logger = new Logger(VintedClient.name);
  private client: ReturnType<typeof wrapper>;
  private sessionReady = false;
  private lastSessionInit: number = 0;
  private userAgent: string = pickUserAgent();
  private readonly baseUrl: string;
  private readonly apiUrl: string;
  readonly countryCode: string;

  constructor(countryCode: string = 'fr') {
    this.countryCode = countryCode;
    this.baseUrl = COUNTRY_DOMAINS[countryCode] ?? COUNTRY_DOMAINS['fr'];
    this.apiUrl = `${this.baseUrl}/api/v2/catalog/items`;
    this.client = this.createHttpClient();
  }

  private createHttpClient(): ReturnType<typeof wrapper> {
    const jar = new CookieJar();
    // Nouveau UA à chaque (re)création de session : la rotation joue au niveau session,
    // pas par requête (un même « visiteur » ne change pas de navigateur en cours de route).
    this.userAgent = pickUserAgent();
    return wrapper(
      axios.create({
        jar,
        withCredentials: true,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      } as any),
    );
  }

  async initSession(): Promise<void> {
    const now = Date.now();
    // Force re-init if session TTL has elapsed
    if (now - this.lastSessionInit > SESSION_TTL_MS) {
      this.sessionReady = false;
    }

    if (this.sessionReady) return;

    try {
      await this.client.get(this.baseUrl, { timeout: 15000 });
      this.sessionReady = true;
      this.lastSessionInit = Date.now();
      this.logger.log(`Session Vinted initialisée [${this.countryCode}]`);
    } catch (err: any) {
      this.logger.warn(`Échec init session [${this.countryCode}]: ${err.message}`);
    }
  }

  resetSession(): void {
    this.client = this.createHttpClient();
    this.sessionReady = false;
    this.lastSessionInit = 0;
  }

  async search(
    searchText: string,
    priceFrom?: number | null,
    priceTo?: number | null,
    perPage = 96,
    page = 1,
    catalogId?: number | null,
  ): Promise<VintedItem[]> {
    await this.initSession();
    try {
      const params: any = {
        search_text: searchText,
        order: 'newest_first',
        per_page: perPage,
        page,
        currency: 'EUR',
      };
      if (priceFrom !== undefined && priceFrom !== null) {
        params.price_from = priceFrom;
      }
      if (priceTo !== undefined && priceTo !== null) {
        params.price_to = priceTo;
      }
      if (catalogId !== undefined && catalogId !== null) {
        params['catalog_ids[]'] = catalogId;
      }

      const response = await this.client.get(this.apiUrl, {
        params,
        headers: {
          Accept: 'application/json, text/plain, */*',
          Referer: `${this.baseUrl}/catalog`,
        },
        timeout: 20000,
      });

      const rawItems: any[] = response.data?.items ?? [];
      const filtered = this.filterByTitle(rawItems, searchText);
      return filtered.map(item => this.parseItem(item)).filter(i => i.price > 0);
    } catch (err: any) {
      if (err.response?.status === 403) {
        this.logger.warn(`Vinted 403 [${this.countryCode}] — reset session`);
        this.resetSession();
        throw new Error('BANNED');
      }
      this.logger.error(`Erreur search [${this.countryCode}] "${searchText}": ${err.message}`);
      return [];
    }
  }

  /**
   * Récupère le profil public d'un vendeur : pays réel (ISO) et nombre d'articles
   * actifs. Le pays sert au filtre pays (country_code ne stockait que le domaine
   * scrapé) ; itemCount sert au filtre "vendeur unique".
   * Retourne null en cas d'erreur (on ne pollue pas le cache).
   */
  async getSellerProfile(sellerId: number): Promise<{ countryIso: string | null; itemCount: number } | null> {
    await this.initSession();
    try {
      const response = await this.client.get(`${this.baseUrl}/api/v2/users/${sellerId}`, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          Referer: `${this.baseUrl}/member/${sellerId}`,
        },
        timeout: 15000,
      });
      const u = response.data?.user ?? response.data ?? {};
      const countryIso = typeof u.country_iso_code === 'string' ? u.country_iso_code.toLowerCase() : null;
      const itemCount = Number(u.item_count ?? u.total_items_count ?? 0) || 0;
      return { countryIso, itemCount };
    } catch (err: any) {
      if (err.response?.status === 403) {
        this.logger.warn(`Vinted 403 [${this.countryCode}] profil ${sellerId} — reset session`);
        this.resetSession();
        throw new Error('BANNED');
      }
      this.logger.warn(`Erreur getSellerProfile [${this.countryCode}] user ${sellerId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Vérifie l'état d'une annonce via sa PAGE web (pas l'API /items/{id}, qui renvoie
   * 404 pour les annonces d'un autre marketplace que le domaine interrogé → faux
   * positifs). La page, elle, suit la redirection cross-border et expose le statut
   * réel dans son JSON embarqué.
   *  - 'gone'   : 404/410 → annonce supprimée (ne mène plus à aucune page)
   *  - 'sold'   : is_closed:true / item_closing_action:"sold" → vendue
   *  - 'active' : is_closed:false → toujours en vente
   *  - null     : indéterminé (page sans marqueur, erreur transitoire) → on ne conclut rien
   */
  async getItemStatus(itemId: number): Promise<'active' | 'sold' | 'gone' | null> {
    await this.initSession();
    try {
      const response = await this.client.get(`${this.baseUrl}/items/${itemId}`, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: `${this.baseUrl}/`,
        },
        timeout: 20000,
        maxRedirects: 5,
        responseType: 'text',
        validateStatus: (s: number) => s < 500, // on inspecte 404 nous-mêmes
      });
      if (response.status === 404 || response.status === 410) return 'gone';
      if (response.status === 403) {
        this.logger.warn(`Vinted 403 [${this.countryCode}] item ${itemId} — reset session`);
        this.resetSession();
        throw new Error('BANNED');
      }
      if (response.status >= 400) return null;
      const html: string = typeof response.data === 'string' ? response.data : String(response.data ?? '');
      // Le JSON est embarqué échappé dans le HTML (is_closed\":true), d'où le backslash optionnel.
      if (/is_closed\\?"\s*:\s*true/.test(html) || /item_closing_action\\?"\s*:\s*\\?"sold/.test(html)) return 'sold';
      if (/is_closed\\?"\s*:\s*false/.test(html)) return 'active';
      return null;
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 404 || status === 410) return 'gone';
      if (status === 403) {
        this.resetSession();
        throw new Error('BANNED');
      }
      this.logger.warn(`Erreur getItemStatus [${this.countryCode}] item ${itemId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Filtre de pertinence. Deux familles de tokens :
   *  - les SPECS (token contenant un chiffre : 8gb, 3200mhz, ddr4, i7) sont
   *    OBLIGATOIRES — une spec différente = un autre produit (pas de DDR3 4 Go
   *    parasite pour une recherche "Ddr4 3200 8gb") ;
   *  - les MOTS descriptifs (purement alphabétiques) tolèrent UN manquant dès
   *    qu'il y en a 3+, pour rattraper les titres FR libellés un peu autrement.
   * Une normalisation unifie en amont les variantes d'écriture (accents, Go/GB,
   * MHz, To/TB, DDR n) pour ne pas écarter des annonces correctes.
   */
  private filterByTitle(items: any[], searchText: string): any[] {
    const tokens = this.normalizeSpecs(searchText)
      .split(/\s+/)
      .filter(t => t.length >= 2);
    if (tokens.length === 0) return items;
    const specTokens = tokens.filter(t => /\d/.test(t));
    const wordTokens = tokens.filter(t => !/\d/.test(t));
    const maxMissingWords = wordTokens.length >= 3 ? 1 : 0;
    return items.filter(item => {
      const title = this.normalizeSpecs(item.title ?? '');
      if (!title) return false;
      if (!specTokens.every(token => title.includes(token))) return false;
      const missingWords = wordTokens.filter(token => !title.includes(token)).length;
      return missingWords <= maxMissingWords;
    });
  }

  /**
   * Normalise titre et recherche pour une comparaison tolérante aux variantes
   * d'écriture : casse, accents (mémoire → memoire), unités (Go/GB, Mo/MB,
   * To/TB, MHz/GHz) et "ddr n" → "ddrn".
   */
  private normalizeSpecs(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents
      .replace(/(\d+)\s*(go|gb)\b/g, '$1gb') // 8 Go / 8GB / 8 gb → 8gb
      .replace(/(\d+)\s*(to|tb)\b/g, '$1tb') // 2 To / 2TB → 2tb
      .replace(/(\d+)\s*(mo|mb)\b/g, '$1mb') // 512 Mo → 512mb
      .replace(/(\d+)\s*(mhz|ghz)\b/g, '$1$2') // 3200 mhz → 3200mhz
      .replace(/\bddr\s+(\d)/g, 'ddr$1'); // ddr 4 → ddr4
  }

  private parseItem(item: any): VintedItem {
    return {
      vinted_id: item.id,
      title: item.title ?? '',
      price: parseFloat(item.price?.amount ?? '0'),
      // Vinted renvoie parfois une URL sur le domaine où l'annonce a été postée
      // (.de, .nl, .pl...) alors que le même item_id est consultable sur .fr —
      // on force donc toujours le domaine fr pour que les liens restent utilisables
      // avec le compte connecté de l'utilisateur (comptes non partagés entre pays).
      url: `${COUNTRY_DOMAINS['fr']}/items/${item.id}`,
      photo_url: item.photo?.url ?? item.photos?.[0]?.url ?? '',
      brand: item.brand_title ?? '',
      size_label: item.size_title ?? '',
      condition_label: item.status ?? '',
      seller_name: item.user?.login ?? '',
      seller_id: item.user?.id ?? 0,
      catalog_id: item.catalog_id ?? null,
      vinted_created_at: item.created_at_ts != null ? new Date(Number(item.created_at_ts) * 1000) : null,
    };
  }
}

/**
 * VintedClientPool manages one VintedClient per country code.
 * Clients are created lazily on first use.
 */
export class VintedClientPool {
  private readonly pool = new Map<string, VintedClient>();

  getClient(countryCode: string): VintedClient {
    const code = countryCode.toLowerCase();
    if (!this.pool.has(code)) {
      this.pool.set(code, new VintedClient(code));
    }
    return this.pool.get(code)!;
  }

  /** Return all currently instantiated clients (useful for health checks). */
  getActiveClients(): VintedClient[] {
    return Array.from(this.pool.values());
  }
}

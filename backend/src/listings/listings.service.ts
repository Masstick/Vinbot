import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Listing } from './listing.entity';
import { KeywordListing } from './keyword-listing.entity';
import { PriceHistory } from './price-history.entity';
import { Keyword } from '../keywords/keyword.entity';

export interface VintedItem {
  vinted_id: number; title: string; price: number; url: string;
  photo_url: string; brand: string; size_label: string;
  condition_label: string; seller_name: string; seller_id: number;
  catalog_id: number | null;
  vinted_created_at: Date | null;
}

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(Listing) private readonly listingRepo: Repository<Listing>,
    @InjectRepository(KeywordListing) private readonly klRepo: Repository<KeywordListing>,
    @InjectRepository(PriceHistory) private readonly historyRepo: Repository<PriceHistory>,
    private readonly dataSource: DataSource,
  ) {}

  async getListingById(listingId: number): Promise<Listing | null> {
    return this.listingRepo.findOneBy({ id: listingId });
  }

  /** Nombre d'annonces déjà associées à un mot-clé — sert à décider d'un bootstrap. */
  async countKeywordListings(keywordId: number): Promise<number> {
    return this.klRepo.countBy({ keyword_id: keywordId });
  }

  /**
   * Met en cache le nb d'annonces du vendeur correspondant au mot-clé, sur toutes
   * les annonces de ce vendeur pour ce mot-clé (une vérif profil sert plusieurs annonces).
   */
  async updateSellerItemCount(keywordId: number, sellerId: number, count: number): Promise<void> {
    await this.dataSource.query(
      `UPDATE keyword_listings kl
       SET seller_item_count = $3, seller_checked_at = NOW()
       FROM listings l
       WHERE kl.listing_id = l.id AND kl.keyword_id = $1 AND l.seller_id = $2`,
      [keywordId, sellerId, count],
    );
  }

  /** Renseigne le pays réel du vendeur sur toutes ses annonces (indépendant du mot-clé). */
  async updateSellerCountry(sellerId: number, countryIso: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE listings SET seller_country = $2 WHERE seller_id = $1`,
      [sellerId, countryIso],
    );
  }

  async upsertListing(item: VintedItem, keyword: Keyword, countryCode?: string): Promise<{ listing: Listing; isNew: boolean; priceChanged: boolean }> {
    const existing = await this.listingRepo.findOneBy({ vinted_id: item.vinted_id });
    let isNew = false; let priceChanged = false; let listing: Listing;
    if (!existing) {
      isNew = true;
      listing = this.listingRepo.create({
        vinted_id: item.vinted_id, title: item.title, price: item.price, url: item.url,
        photo_url: item.photo_url, brand: item.brand, size_label: item.size_label,
        condition_label: item.condition_label, seller_name: item.seller_name,
        seller_id: item.seller_id, country_code: countryCode ?? 'fr', last_seen_at: new Date(),
        vinted_created_at: item.vinted_created_at ?? null,
      });
      listing = await this.listingRepo.save(listing);
      await this.historyRepo.save({ listing_id: listing.id, price: item.price });
    } else {
      listing = existing;
      await this.listingRepo.update(existing.id, { last_seen_at: new Date() });
      if (parseFloat(String(existing.price)) !== item.price) {
        priceChanged = true;
        await this.listingRepo.update(existing.id, { price: item.price });
        await this.historyRepo.save({ listing_id: existing.id, price: item.price });
        listing.price = item.price;
      }
    }
    await this.klRepo.upsert(
      { keyword_id: keyword.id, listing_id: listing.id, matched_at: new Date() },
      ['keyword_id', 'listing_id'],
    );
    return { listing, isNew, priceChanged };
  }

  async getListings(opts: { keywordId?: number; limit?: number; offset?: number; country?: string; q?: string; maxAgeHours?: number; soloSeller?: boolean } = {}): Promise<any[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const params: any[] = [];
    const where: string[] = [];
    if (opts.keywordId) { params.push(opts.keywordId); where.push(`kl.keyword_id = $${params.length}`); }
    // On filtre sur le pays réel du vendeur (seller_country) quand il est connu,
    // sinon on retombe sur le domaine scrapé (country_code).
    if (opts.country) { params.push(opts.country.toLowerCase()); where.push(`LOWER(COALESCE(l.seller_country, l.country_code)) = $${params.length}`); }
    if (opts.q) { params.push(`%${opts.q}%`); where.push(`l.title ILIKE $${params.length}`); }
    if (opts.maxAgeHours) { params.push(opts.maxAgeHours); where.push(`l.first_seen_at > NOW() - ($${params.length} || ' hours')::interval`); }
    if (opts.soloSeller) {
      // "Vendeur unique" : le profil Vinted du vendeur ne contient qu'une seule
      // annonce active correspondant au mot-clé (compte rafraîchi en arrière-plan
      // par le scraper via countSellerItemsMatching). NULL = pas encore vérifié → exclu.
      where.push(`kl.seller_item_count IS NOT NULL AND kl.seller_item_count <= 1`);
    }
    params.push(limit, offset);
    // DISTINCT ON : une seule ligne par annonce même si elle matche plusieurs mots-clés
    const sql = `
      SELECT * FROM (
        SELECT DISTINCT ON (l.id)
          l.*, kl.matched_at,
          kl.seller_item_count,
          k.label AS keyword_label, k.id AS keyword_id,
          EXTRACT(EPOCH FROM (NOW() - l.first_seen_at)) / 3600 AS freshness_hours
        FROM keyword_listings kl
        INNER JOIN listings l ON l.id = kl.listing_id
        INNER JOIN keywords k ON k.id = kl.keyword_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY l.id, kl.matched_at DESC
      ) t
      ORDER BY t.first_seen_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    return this.dataSource.query(sql, params);
  }

  async getPriceHistory(listingId: number): Promise<PriceHistory[]> {
    return this.historyRepo.find({ where: { listing_id: listingId }, order: { recorded_at: 'ASC' } });
  }

  async getListing(id: number): Promise<any> {
    const rows = await this.dataSource.query(
      `SELECT l.*, EXTRACT(EPOCH FROM (NOW() - l.first_seen_at)) / 3600 AS freshness_hours FROM listings l WHERE l.id = $1`,
      [id],
    );
    if (!rows.length) return null;
    const listing = rows[0];
    const kls = await this.klRepo.find({ where: { listing_id: id }, relations: ['keyword'] });
    const history = await this.getPriceHistory(id);
    return { ...listing, keyword_listings: kls, price_history: history };
  }

  async getStats(): Promise<any> {
    const totalListings = await this.listingRepo.count();
    const totalKeywords = await this.dataSource.query('SELECT COUNT(*) FROM keywords WHERE active = true');
    const recentAlerts = await this.dataSource.query("SELECT COUNT(*) FROM notifications_log WHERE sent_at > NOW() - INTERVAL '24 hours'");
    const newListings24h = await this.dataSource.query("SELECT COUNT(*) FROM listings WHERE first_seen_at > NOW() - INTERVAL '24 hours'");
    return {
      total_listings: totalListings,
      active_keywords: parseInt(totalKeywords[0].count),
      alerts_24h: parseInt(recentAlerts[0].count),
      listings_24h: parseInt(newListings24h[0].count),
    };
  }
}

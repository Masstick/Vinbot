import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Listing } from './listing.entity';
import { KeywordListing } from './keyword-listing.entity';
import { PriceHistory } from './price-history.entity';
import { Keyword } from '../keywords/keyword.entity';

export interface VintedItem {
  vinted_id: number;
  title: string;
  price: number;
  url: string;
  photo_url: string;
  brand: string;
  size_label: string;
  condition_label: string;
  seller_name: string;
  seller_id: number;
  catalog_id: number | null;
}

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(Listing)
    private readonly listingRepo: Repository<Listing>,
    @InjectRepository(KeywordListing)
    private readonly klRepo: Repository<KeywordListing>,
    @InjectRepository(PriceHistory)
    private readonly historyRepo: Repository<PriceHistory>,
    private readonly dataSource: DataSource,
  ) {}

  async computeMarketAvg(keywordId: number): Promise<number | null> {
    const rows = await this.listingRepo
      .createQueryBuilder('l')
      .innerJoin('keyword_listings', 'kl', 'kl.listing_id = l.id AND kl.keyword_id = :kid', { kid: keywordId })
      .select('l.price', 'price')
      .where('l.price IS NOT NULL')
      .orderBy('l.last_seen_at', 'DESC')
      .limit(200)
      .getRawMany<{ price: string }>();

    if (rows.length < 2) return null;

    const prices = rows.map(r => parseFloat(r.price)).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const filtered = prices.filter(p => p <= median * 5 && p > 0.5);
    if (filtered.length === 0) return null;

    const start = Math.floor(filtered.length * 0.1);
    const end = filtered.length - start;
    const mid = filtered.slice(start, end || 1);
    return mid.reduce((a, b) => a + b, 0) / mid.length;
  }

  async upsertListing(item: VintedItem, keyword: Keyword): Promise<{ listing: Listing; isNew: boolean; priceChanged: boolean }> {
    const existing = await this.listingRepo.findOneBy({ vinted_id: item.vinted_id });
    let isNew = false;
    let priceChanged = false;

    let listing: Listing;
    if (!existing) {
      isNew = true;
      listing = this.listingRepo.create({
        vinted_id: item.vinted_id,
        title: item.title,
        price: item.price,
        url: item.url,
        photo_url: item.photo_url,
        brand: item.brand,
        size_label: item.size_label,
        condition_label: item.condition_label,
        seller_name: item.seller_name,
        seller_id: item.seller_id,
        last_seen_at: new Date(),
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

    const marketAvg = await this.computeMarketAvg(keyword.id);
    const shippingEst = parseFloat(String(keyword.shipping_estimate)) || 4;
    const dealScore = marketAvg ? ((marketAvg - item.price) / marketAvg) * 100 : null;
    const potentialProfit = marketAvg ? marketAvg - item.price - shippingEst : null;

    await this.klRepo.upsert(
      {
        keyword_id: keyword.id,
        listing_id: listing.id,
        deal_score: dealScore,
        market_avg: marketAvg,
        potential_profit: potentialProfit,
        matched_at: new Date(),
      },
      ['keyword_id', 'listing_id'],
    );

    return { listing, isNew, priceChanged };
  }

  async getOpportunities(keywordId?: number, limit = 50): Promise<any[]> {
    const qb = this.klRepo
      .createQueryBuilder('kl')
      .innerJoinAndSelect('kl.listing', 'l')
      .innerJoinAndSelect('kl.keyword', 'k')
      .where('kl.potential_profit IS NOT NULL')
      .orderBy('kl.potential_profit', 'DESC')
      .limit(limit);

    if (keywordId) qb.andWhere('kl.keyword_id = :kid', { kid: keywordId });

    return qb.getMany();
  }

  async getListings(keywordId?: number, limit = 100): Promise<any[]> {
    const qb = this.klRepo
      .createQueryBuilder('kl')
      .innerJoinAndSelect('kl.listing', 'l')
      .innerJoinAndSelect('kl.keyword', 'k')
      .orderBy('kl.matched_at', 'DESC')
      .limit(limit);

    if (keywordId) qb.andWhere('kl.keyword_id = :kid', { kid: keywordId });

    return qb.getMany();
  }

  async getPriceHistory(listingId: number): Promise<PriceHistory[]> {
    return this.historyRepo.find({
      where: { listing_id: listingId },
      order: { recorded_at: 'ASC' },
    });
  }

  async getListing(id: number): Promise<any> {
    const listing = await this.listingRepo.findOneBy({ id });
    if (!listing) return null;
    const kls = await this.klRepo.find({
      where: { listing_id: id },
      relations: ['keyword'],
    });
    const history = await this.getPriceHistory(id);
    return { ...listing, keyword_listings: kls, price_history: history };
  }

  async getKeywordListing(keywordId: number, listingId: number): Promise<KeywordListing | null> {
    return this.klRepo.findOneBy({ keyword_id: keywordId, listing_id: listingId });
  }

  async getStats(): Promise<any> {
    const totalListings = await this.listingRepo.count();
    const totalKeywords = await this.dataSource.query('SELECT COUNT(*) FROM keywords WHERE active = true');
    const topDeals = await this.klRepo.count({ where: { potential_profit: undefined } });
    const recentAlerts = await this.dataSource.query(
      "SELECT COUNT(*) FROM notifications_log WHERE sent_at > NOW() - INTERVAL '24 hours'"
    );
    return {
      total_listings: totalListings,
      active_keywords: parseInt(totalKeywords[0].count),
      alerts_24h: parseInt(recentAlerts[0].count),
    };
  }
}

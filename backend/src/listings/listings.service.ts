import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Listing } from './listing.entity';
import { KeywordListing } from './keyword-listing.entity';
import { PriceHistory } from './price-history.entity';
import { Keyword } from '../keywords/keyword.entity';
import { ModelMarketAvg } from '../analysis/model-market-avg.entity';
import { DealAnalysis } from '../analysis/deal-analysis.entity';

export interface VintedItem {
  vinted_id: number; title: string; price: number; url: string;
  photo_url: string; brand: string; size_label: string;
  condition_label: string; seller_name: string; seller_id: number;
  catalog_id: number | null;
  vinted_created_at: Date | null;
}

export interface MarketAvgResult {
  avg: number | null;
  itemCount: number;
  source: 'model' | 'keyword';
}

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(Listing) private readonly listingRepo: Repository<Listing>,
    @InjectRepository(KeywordListing) private readonly klRepo: Repository<KeywordListing>,
    @InjectRepository(PriceHistory) private readonly historyRepo: Repository<PriceHistory>,
    @InjectRepository(ModelMarketAvg) private readonly modelAvgRepo: Repository<ModelMarketAvg>,
    @InjectRepository(DealAnalysis) private readonly analysisRepo: Repository<DealAnalysis>,
    private readonly dataSource: DataSource,
  ) {}

  async computeMarketAvg(keywordId: number, modelLabel?: string | null): Promise<MarketAvgResult> {
    // Model-specific avg: requires at least 3 data points to be meaningful
    if (modelLabel) {
      const mma = await this.modelAvgRepo.findOneBy({ keyword_id: keywordId, model_label: modelLabel });
      if (mma && mma.avg_price && mma.item_count >= 3) {
        return { avg: parseFloat(String(mma.avg_price)), itemCount: mma.item_count, source: 'model' };
      }
    }
    // Fallback: P15-P85 trimmed mean across recent keyword listings
    const rows = await this.listingRepo
      .createQueryBuilder('l')
      .innerJoin('keyword_listings', 'kl', 'kl.listing_id = l.id AND kl.keyword_id = :kid', { kid: keywordId })
      .select('l.price', 'price')
      .where('l.price IS NOT NULL')
      .orderBy('l.last_seen_at', 'DESC')
      .limit(200)
      .getRawMany<{ price: string }>();
    if (rows.length < 2) return { avg: null, itemCount: rows.length, source: 'keyword' };
    const prices = rows.map(r => parseFloat(r.price)).filter(p => p > 0.5).sort((a, b) => a - b);
    if (prices.length === 0) return { avg: null, itemCount: 0, source: 'keyword' };
    const startIdx = Math.floor(prices.length * 0.15);
    const endIdx = prices.length - startIdx;
    const trimmed = prices.slice(startIdx, endIdx || 1);
    if (trimmed.length === 0) return { avg: null, itemCount: 0, source: 'keyword' };
    const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    return { avg, itemCount: trimmed.length, source: 'keyword' };
  }

  async updateModelMarketAvg(keywordId: number, modelLabel: string, price: number): Promise<void> {
    const existing = await this.modelAvgRepo.findOneBy({ keyword_id: keywordId, model_label: modelLabel });
    if (!existing) {
      await this.modelAvgRepo.save({ keyword_id: keywordId, model_label: modelLabel, avg_price: price, item_count: 1, last_updated: new Date() });
      return;
    }
    const newCount = existing.item_count + 1;
    const prevAvg = parseFloat(String(existing.avg_price ?? price));
    const newAvg = (prevAvg * existing.item_count + price) / newCount;
    await this.modelAvgRepo.save({ keyword_id: keywordId, model_label: modelLabel, avg_price: newAvg, item_count: newCount, last_updated: new Date() });
  }

  async rescoreWithModel(listingId: number, keywordId: number, modelLabel: string, shippingEstimate: number): Promise<{ marketAvg: number | null; itemCount: number; potentialProfit: number | null; dealScore: number | null }> {
    const listing = await this.listingRepo.findOneBy({ id: listingId });
    if (!listing) return { marketAvg: null, itemCount: 0, potentialProfit: null, dealScore: null };
    const { avg: marketAvg, itemCount } = await this.computeMarketAvg(keywordId, modelLabel);
    const price = parseFloat(String(listing.price ?? 0));
    const dealScore = marketAvg ? ((marketAvg - price) / marketAvg) * 100 : null;
    const potentialProfit = marketAvg ? marketAvg - price - shippingEstimate : null;
    await this.klRepo.upsert(
      { keyword_id: keywordId, listing_id: listingId, deal_score: dealScore, market_avg: marketAvg, model_market_avg: marketAvg, potential_profit: potentialProfit, matched_at: new Date() },
      ['keyword_id', 'listing_id'],
    );
    return { marketAvg, itemCount, potentialProfit, dealScore };
  }

  async saveDealAnalysis(listingId: number, keywordId: number, analysis: { scam_risk: string; confidence: number; recommendation: string; reasoning: string }): Promise<DealAnalysis> {
    const existing = await this.analysisRepo.findOneBy({ listing_id: listingId, keyword_id: keywordId });
    if (existing) {
      await this.analysisRepo.update(existing.id, { ...analysis, analyzed_at: new Date() });
      const updated = await this.analysisRepo.findOneBy({ id: existing.id });
      await this.klRepo.upsert({ keyword_id: keywordId, listing_id: listingId, analysis_id: updated!.id }, ['keyword_id', 'listing_id']);
      return updated!;
    }
    const saved = await this.analysisRepo.save({ listing_id: listingId, keyword_id: keywordId, ...analysis });
    await this.klRepo.upsert({ keyword_id: keywordId, listing_id: listingId, analysis_id: saved.id }, ['keyword_id', 'listing_id']);
    return saved;
  }

  async updateListingModel(listingId: number, modelLabel: string, confidence: number): Promise<void> {
    await this.listingRepo.update(listingId, { model_label: modelLabel, model_confidence: confidence });
  }

  async getListingById(listingId: number): Promise<Listing | null> {
    return this.listingRepo.findOneBy({ id: listingId });
  }

  async getListingsWithoutModel(limit = 200): Promise<Array<{ listing: Listing; keywordId: number; shippingEstimate: number; targetMargin: number }>> {
    const rows = await this.dataSource.query<Array<{ id: number; keyword_id: number; shipping_estimate: string; target_margin: string }>>(
      `SELECT DISTINCT ON (l.id) l.id, kl.keyword_id, k.shipping_estimate, k.target_margin
       FROM listings l
       INNER JOIN keyword_listings kl ON kl.listing_id = l.id
       INNER JOIN keywords k ON k.id = kl.keyword_id
       WHERE l.model_label IS NULL AND l.title IS NOT NULL
       ORDER BY l.id DESC
       LIMIT $1`,
      [limit],
    );
    const results: Array<{ listing: Listing; keywordId: number; shippingEstimate: number; targetMargin: number }> = [];
    for (const row of rows) {
      const listing = await this.listingRepo.findOneBy({ id: row.id });
      if (listing) results.push({ listing, keywordId: row.keyword_id, shippingEstimate: parseFloat(String(row.shipping_estimate)) || 4, targetMargin: parseFloat(String(row.target_margin)) || 10 });
    }
    return results;
  }

  async upsertListing(item: VintedItem, keyword: Keyword, countryCode?: string): Promise<{ listing: Listing; isNew: boolean; priceChanged: boolean; dealScore: number | null; potentialProfit: number | null }> {
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
    const { avg: marketAvg } = await this.computeMarketAvg(keyword.id, listing.model_label);
    const shippingEst = parseFloat(String(keyword.shipping_estimate)) || 4;
    const dealScore = marketAvg ? ((marketAvg - item.price) / marketAvg) * 100 : null;
    const potentialProfit = marketAvg ? marketAvg - item.price - shippingEst : null;
    await this.klRepo.upsert(
      { keyword_id: keyword.id, listing_id: listing.id, deal_score: dealScore, market_avg: marketAvg, potential_profit: potentialProfit, matched_at: new Date() },
      ['keyword_id', 'listing_id'],
    );
    return { listing, isNew, priceChanged, dealScore, potentialProfit };
  }

  async getValidated(limit = 50): Promise<any[]> {
    const rows = await this.dataSource.query(
      `SELECT kl.keyword_id, kl.listing_id, kl.deal_score, kl.market_avg,
        kl.model_market_avg, kl.potential_profit, kl.matched_at,
        l.id AS l_id, l.title, l.price, l.url, l.photo_url, l.brand,
        l.condition_label, l.size_label, l.seller_name, l.first_seen_at,
        l.vinted_created_at, l.model_label, l.model_confidence, l.country_code,
        EXTRACT(EPOCH FROM (NOW() - l.first_seen_at)) / 3600 AS freshness_hours,
        k.id AS k_id, k.label AS keyword_label, k.target_margin, k.shipping_estimate,
        da.id AS analysis_id, da.scam_risk, da.confidence AS analysis_confidence,
        da.recommendation, da.reasoning, da.analyzed_at
       FROM keyword_listings kl
       INNER JOIN listings l ON l.id = kl.listing_id
       INNER JOIN keywords k ON k.id = kl.keyword_id
       INNER JOIN deal_analyses da ON da.id = kl.analysis_id
       WHERE da.recommendation IN ('buy', 'watch') AND da.scam_risk != 'high'
       ORDER BY da.confidence DESC, kl.potential_profit DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map((row: any) => ({
      keyword_id: row.keyword_id,
      listing_id: row.listing_id,
      deal_score: row.deal_score,
      market_avg: row.market_avg,
      model_market_avg: row.model_market_avg,
      potential_profit: row.potential_profit,
      matched_at: row.matched_at,
      recommendation: row.recommendation,
      scam_risk: row.scam_risk,
      analysis_confidence: row.analysis_confidence,
      listing: {
        id: row.l_id,
        title: row.title,
        price: row.price,
        url: row.url,
        photo_url: row.photo_url,
        brand: row.brand,
        condition_label: row.condition_label,
        size_label: row.size_label,
        seller_name: row.seller_name,
        first_seen_at: row.first_seen_at,
        vinted_created_at: row.vinted_created_at,
        model_label: row.model_label,
        model_confidence: row.model_confidence,
        country_code: row.country_code,
        freshness_hours: parseFloat(row.freshness_hours) || 0,
        reasoning: row.reasoning,
      },
      keyword: {
        id: row.k_id,
        label: row.keyword_label,
        target_margin: row.target_margin,
        shipping_estimate: row.shipping_estimate,
      },
    }));
  }

  async getOpportunities(keywordId?: number, limit = 50): Promise<any[]> {
    const qb = this.klRepo.createQueryBuilder('kl').innerJoinAndSelect('kl.listing', 'l').innerJoinAndSelect('kl.keyword', 'k').where('kl.potential_profit IS NOT NULL').orderBy('kl.potential_profit', 'DESC').limit(limit);
    if (keywordId) qb.andWhere('kl.keyword_id = :kid', { kid: keywordId });
    return qb.getMany();
  }

  async getListings(keywordId?: number, limit = 100): Promise<any[]> {
    let sql = `
      SELECT l.*, kl.deal_score, kl.market_avg, kl.model_market_avg, kl.potential_profit, kl.matched_at,
        k.label AS keyword_label, k.id AS keyword_id,
        EXTRACT(EPOCH FROM (NOW() - l.first_seen_at)) / 3600 AS freshness_hours,
        da.recommendation, da.scam_risk, da.reasoning
      FROM keyword_listings kl
      INNER JOIN listings l ON l.id = kl.listing_id
      INNER JOIN keywords k ON k.id = kl.keyword_id
      LEFT JOIN deal_analyses da ON da.id = kl.analysis_id
    `;
    const params: any[] = [];
    if (keywordId) { params.push(keywordId); sql += ` WHERE kl.keyword_id = $${params.length}`; }
    sql += ` ORDER BY kl.matched_at DESC LIMIT ${limit}`;
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
    const analysis = await this.analysisRepo.findOneBy({ listing_id: id });
    return { ...listing, keyword_listings: kls, price_history: history, analysis };
  }

  async getKeywordListing(keywordId: number, listingId: number): Promise<KeywordListing | null> {
    return this.klRepo.findOneBy({ keyword_id: keywordId, listing_id: listingId });
  }

  async getStats(): Promise<any> {
    const totalListings = await this.listingRepo.count();
    const totalKeywords = await this.dataSource.query('SELECT COUNT(*) FROM keywords WHERE active = true');
    const recentAlerts = await this.dataSource.query("SELECT COUNT(*) FROM notifications_log WHERE sent_at > NOW() - INTERVAL '24 hours'");
    const validatedDeals = await this.dataSource.query("SELECT COUNT(*) FROM deal_analyses WHERE recommendation IN ('buy','watch') AND scam_risk != 'high'");
    return {
      total_listings: totalListings,
      active_keywords: parseInt(totalKeywords[0].count),
      alerts_24h: parseInt(recentAlerts[0].count),
      validated_deals: parseInt(validatedDeals[0].count),
    };
  }
}

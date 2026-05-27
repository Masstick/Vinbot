import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KeywordsService } from '../keywords/keywords.service';
import { ListingsService } from '../listings/listings.service';
import { TelegramService } from '../notifications/telegram.service';
import { DealsGateway } from '../notifications/deals.gateway';
import { MistralService } from '../analysis/mistral.service';
import { VintedClient } from './vinted.client';
import { Keyword } from '../keywords/keyword.entity';
import { Listing } from '../listings/listing.entity';
import { AsyncQueue } from '../analysis/async-queue';

const FAST_TICK_MS = 30_000;
const MARKET_TICK_MS = 600_000;

/** Retourne un entier aléatoire entre min et max (inclus) */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

interface ModelQueueItem {
  listingId: number;
  title: string;
  price: number;
  keywordId: number;
  shippingEstimate: number;
  targetMargin: number;
  keyword: Keyword;
}

interface AnalysisQueueItem {
  listing: Listing;
  keyword: Keyword;
  marketAvg: number;
  itemCount: number;
}

@Injectable()
export class ScraperService implements OnModuleInit {
  private readonly logger = new Logger(ScraperService.name);
  private readonly vintedClient = new VintedClient();
  private isFastRunning = false;
  private isMarketRunning = false;
  private lastRunAt: Map<number, number> = new Map();
  private lastScrapeTime: Date | null = null;

  private readonly modelQueue: AsyncQueue<ModelQueueItem>;
  private readonly analysisQueue: AsyncQueue<AnalysisQueueItem>;

  constructor(
    private readonly keywordsService: KeywordsService,
    private readonly listingsService: ListingsService,
    private readonly telegramService: TelegramService,
    private readonly dealsGateway: DealsGateway,
    private readonly mistralService: MistralService,
  ) {
    this.modelQueue = new AsyncQueue(this.processModelExtraction.bind(this), 3, 5);
    this.analysisQueue = new AsyncQueue(this.processDealAnalysis.bind(this), 1, 3);
  }

  onModuleInit() {
    this.logger.log('ScraperService initialisé — premier fast scan dans 5s');
    setTimeout(() => this.scheduleFastTick(), 5000);
    setTimeout(() => this.scheduleMarketTick(), MARKET_TICK_MS);
  }

  private scheduleFastTick(): void {
    this.fastTick().finally(() => {
      const next = randInt(25_000, 35_000);
      setTimeout(() => this.scheduleFastTick(), next);
    });
  }

  private scheduleMarketTick(): void {
    this.marketTick().finally(() => {
      const next = randInt(540_000, 660_000);
      setTimeout(() => this.scheduleMarketTick(), next);
    });
  }

  async fastTick() {
    if (this.isFastRunning) return;
    this.isFastRunning = true;
    try {
      await this.runFastScan();
    } finally {
      this.isFastRunning = false;
    }
  }

  async marketTick() {
    if (this.isMarketRunning) return;
    this.isMarketRunning = true;
    try {
      await this.runMarketScan();
    } finally {
      this.isMarketRunning = false;
    }
  }

  private async runFastScan(): Promise<void> {
    const keywords = await this.keywordsService.findActive();
    if (keywords.length === 0) return;

    for (const keyword of keywords) {
      try {
        const items = await this.vintedClient.search(
          keyword.search_text, keyword.min_price, keyword.max_price, 96, 1, keyword.catalog_id,
        );
        if (items.length === 0) continue;

        let newCount = 0;
        for (const item of items) {
          const { listing, isNew, priceChanged } = await this.listingsService.upsertListing(item, keyword);
          if (!isNew && !priceChanged) continue;
          newCount++;

          if (isNew && this.mistralService.isEnabled()) {
            this.modelQueue.push({
              listingId: listing.id,
              title: listing.title ?? item.title,
              price: parseFloat(String(listing.price ?? item.price)),
              keywordId: keyword.id,
              shippingEstimate: parseFloat(String(keyword.shipping_estimate)) || 4,
              targetMargin: parseFloat(String(keyword.target_margin)) || 10,
              keyword,
            }).catch(() => {});
          } else if (isNew || priceChanged) {
            await this.maybeAlertClassic(listing, keyword);
          }
        }

        this.lastRunAt.set(keyword.id, Date.now());
        this.lastScrapeTime = new Date();
        this.logger.log(`[FastScan] "${keyword.search_text}" → ${items.length} annonces, ${newCount} nouvelles/modifiées`);
      } catch (err: any) {
        if (err.message === 'BANNED') {
          this.logger.warn(`[FastScan] Keyword #${keyword.id} bloqué — pause 60s`);
          await this.delay(60_000);
        } else {
          this.logger.error(`[FastScan] Keyword #${keyword.id}: ${err.message}`);
        }
      }
      if (keywords.indexOf(keyword) < keywords.length - 1) {
        await this.delay(randInt(3_000, 7_000));
      }
    }
  }

  private async runMarketScan(): Promise<void> {
    if (!this.mistralService.isEnabled()) return;
    const keywords = await this.keywordsService.findActive();
    for (const keyword of keywords) {
      const pages = keyword.market_scan_pages ?? 5;
      for (let page = 2; page <= pages; page++) {
        try {
          const items = await this.vintedClient.search(
            keyword.search_text, keyword.min_price, keyword.max_price, 96, page, keyword.catalog_id,
          );
          if (items.length === 0) break;
          for (const item of items) {
            const { listing, isNew } = await this.listingsService.upsertListing(item, keyword);
            if (isNew && item.title) {
              this.modelQueue.push({
                listingId: listing.id,
                title: listing.title ?? item.title,
                price: parseFloat(String(listing.price ?? item.price)),
                keywordId: keyword.id,
                shippingEstimate: parseFloat(String(keyword.shipping_estimate)) || 4,
                targetMargin: parseFloat(String(keyword.target_margin)) || 10,
                keyword,
              }).catch(() => {});
            }
          }
          await this.delay(randInt(2_000, 5_000));
        } catch (err: any) {
          if (err.message === 'BANNED') break;
          this.logger.error(`[MarketScan] Keyword #${keyword.id} page ${page}: ${err.message}`);
          break;
        }
      }
      this.logger.log(`[MarketScan] "${keyword.search_text}" pages 2-${pages} traités`);
      if (keywords.indexOf(keyword) < keywords.length - 1) await this.delay(randInt(4_000, 8_000));
    }
  }

  private async processModelExtraction(item: ModelQueueItem): Promise<void> {
    const extraction = await this.mistralService.extractModel(item.title, item.price);
    if (!extraction.model_label) return;

    await this.listingsService.updateListingModel(item.listingId, extraction.model_label, extraction.confidence);
    await this.listingsService.updateModelMarketAvg(item.keywordId, extraction.model_label, item.price);

    const { marketAvg, itemCount, potentialProfit } = await this.listingsService.rescoreWithModel(
      item.listingId, item.keywordId, extraction.model_label, item.shippingEstimate,
    );

    if (marketAvg && potentialProfit !== null && potentialProfit >= item.targetMargin) {
      const listing = await this.listingsService.getListingById(item.listingId);
      if (listing) {
        this.analysisQueue.push({ listing, keyword: item.keyword, marketAvg, itemCount }).catch(() => {});
      }
    }
  }

  private async processDealAnalysis(item: AnalysisQueueItem): Promise<void> {
    const result = await this.mistralService.analyzeDeal(item.listing, item.keyword, item.marketAvg, item.itemCount);
    if (!result) return;

    await this.listingsService.saveDealAnalysis(item.listing.id, item.keyword.id, result);

    if (result.recommendation !== 'skip' && result.scam_risk !== 'high') {
      const price = parseFloat(String(item.listing.price ?? 0));
      const shippingEst = parseFloat(String(item.keyword.shipping_estimate)) || 4;
      const potentialProfit = item.marketAvg - price - shippingEst;
      const dealScore = ((item.marketAvg - price) / item.marketAvg) * 100;

      this.dealsGateway.emitNewDeal({
        listingId: item.listing.id,
        title: item.listing.title ?? 'Sans titre',
        price,
        marketAvg: item.marketAvg,
        profit: potentialProfit,
        dealScore,
        photoUrl: item.listing.photo_url ?? null,
        url: item.listing.url ?? null,
        keywordLabel: item.keyword.label,
      });

      this.logger.log(`✅ Deal validé IA : "${item.listing.title}" → +${potentialProfit.toFixed(0)}€ (${result.recommendation}, scam: ${result.scam_risk})`);
    }
  }

  private async maybeAlertClassic(listing: Listing, keyword: Keyword): Promise<void> {
    const kl = await this.listingsService.getKeywordListing(keyword.id, listing.id);
    if (!kl) return;
    const potentialProfit = parseFloat(String(kl.potential_profit ?? 0));
    const targetMargin = parseFloat(String(keyword.target_margin ?? 10));
    if (potentialProfit >= targetMargin && kl.market_avg) {
      const marketAvg = parseFloat(String(kl.market_avg));
      const dealScore = parseFloat(String(kl.deal_score ?? 0));
      await this.telegramService.sendDealAlert(listing, keyword, dealScore, marketAvg, potentialProfit);
      this.dealsGateway.emitNewDeal({
        listingId: listing.id,
        title: listing.title ?? 'Sans titre',
        price: parseFloat(String(listing.price ?? 0)),
        marketAvg,
        profit: potentialProfit,
        dealScore,
        photoUrl: listing.photo_url ?? null,
        url: listing.url ?? null,
        keywordLabel: keyword.label,
      });
    }
  }

  async getStatus() {
    const keywords = await this.keywordsService.findActive();
    return {
      isFastRunning: this.isFastRunning,
      isMarketRunning: this.isMarketRunning,
      lastScrapeTime: this.lastScrapeTime,
      activeKeywords: keywords.length,
      mistralEnabled: this.mistralService.isEnabled(),
      queueStats: {
        model: this.modelQueue.getStats(),
        analysis: this.analysisQueue.getStats(),
      },
      keywords: keywords.map(kw => ({
        id: kw.id,
        label: kw.label,
        lastRunAt: this.lastRunAt.get(kw.id) ? new Date(this.lastRunAt.get(kw.id)!) : null,
        nextRunInSeconds: 0,
      })),
    };
  }

  async backfill(keywordId?: number, pages = 20) {
    const allKeywords = await this.keywordsService.findActive();
    const keywords = keywordId ? allKeywords.filter(kw => kw.id === keywordId) : allKeywords;
    const results: { keyword: string; pages: number; inserted: number }[] = [];
    for (const keyword of keywords) {
      let inserted = 0; let completedPages = 0;
      for (let page = 1; page <= pages; page++) {
        try {
          const items = await this.vintedClient.search(keyword.search_text, keyword.min_price, keyword.max_price, 96, page, keyword.catalog_id);
          if (items.length === 0) break;
          for (const item of items) {
            const { isNew } = await this.listingsService.upsertListing(item, keyword);
            if (isNew) inserted++;
          }
          completedPages++;
          if (page < pages) await this.delay(3000);
        } catch (err: any) {
          if (err.message === 'BANNED') break;
          break;
        }
      }
      results.push({ keyword: keyword.label, pages: completedPages, inserted });
      if (keywords.indexOf(keyword) < keywords.length - 1) await this.delay(5000);
    }
    return results;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { KeywordsService } from '../keywords/keywords.service';
import { ListingsService } from '../listings/listings.service';
import { TelegramService } from '../notifications/telegram.service';
import { DealsGateway } from '../notifications/deals.gateway';
import { VintedClient } from './vinted.client';
import { Keyword } from '../keywords/keyword.entity';

const BETWEEN_KEYWORDS_DELAY_MS = 5000;
const SCRAPER_TICK_MS = 15000;

@Injectable()
export class ScraperService implements OnModuleInit {
  private readonly logger = new Logger(ScraperService.name);
  private readonly vintedClient = new VintedClient();
  private isRunning = false;
  private lastRunAt: Map<number, number> = new Map();
  private lastScrapeTime: Date | null = null;

  constructor(
    private readonly keywordsService: KeywordsService,
    private readonly listingsService: ListingsService,
    private readonly telegramService: TelegramService,
    private readonly dealsGateway: DealsGateway,
  ) {}

  onModuleInit() {
    this.logger.log('ScraperService initialisé — premier cycle dans 5s');
    setTimeout(() => this.tick(), 5000);
  }

  @Interval(SCRAPER_TICK_MS)
  async tick() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      await this.processNextDueKeyword();
    } finally {
      this.isRunning = false;
    }
  }

  private async processNextDueKeyword(): Promise<void> {
    const keywords = await this.keywordsService.findActive();
    if (keywords.length === 0) return;

    const now = Date.now();
    const due = keywords.filter(kw => {
      const last = this.lastRunAt.get(kw.id) ?? 0;
      return now - last >= kw.scan_interval_seconds * 1000;
    });

    if (due.length === 0) return;

    for (const keyword of due) {
      await this.processKeyword(keyword);
      this.lastRunAt.set(keyword.id, Date.now());
      this.lastScrapeTime = new Date();

      if (due.indexOf(keyword) < due.length - 1) {
        await this.delay(BETWEEN_KEYWORDS_DELAY_MS);
      }
    }
  }

  private async processKeyword(keyword: Keyword): Promise<void> {
    this.logger.log(`Scraping keyword #${keyword.id} : "${keyword.search_text}"`);
    try {
      const items = await this.vintedClient.search(
        keyword.search_text,
        keyword.min_price,
        keyword.max_price,
        96,
        1,
        keyword.catalog_id,
      );
      if (items.length === 0) {
        this.logger.log(`  → 0 résultats`);
        return;
      }

      let newCount = 0;
      let alertCount = 0;

      for (const item of items) {
        const { listing, isNew, priceChanged } = await this.listingsService.upsertListing(item, keyword);

        if (!isNew && !priceChanged) continue;
        newCount++;

        const kl = await this.listingsService.getKeywordListing(keyword.id, listing.id);
        if (!kl) continue;

        const potentialProfit = parseFloat(String(kl.potential_profit ?? 0));
        const dealScore = parseFloat(String(kl.deal_score ?? 0));
        const marketAvg = parseFloat(String(kl.market_avg ?? 0));
        const targetMargin = parseFloat(String(keyword.target_margin ?? 10));
        const maxPrice = keyword.max_price ? parseFloat(String(keyword.max_price)) : null;

        const shouldAlert =
          (potentialProfit >= targetMargin) ||
          (maxPrice !== null && item.price <= maxPrice);

        if (shouldAlert && marketAvg > 0) {
          // Notification Telegram (1x par 24h par annonce)
          await this.telegramService.sendDealAlert(listing, keyword, dealScore, marketAvg, potentialProfit);
          alertCount++;

          // Notification WebSocket temps réel (instantanée, à chaque détection)
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

      this.logger.log(`  → ${items.length} annonces | ${newCount} nouvelles/modifiées | ${alertCount} alertes`);
    } catch (err: any) {
      if (err.message === 'BANNED') {
        this.logger.warn(`Keyword #${keyword.id} bloqué (403) — pause 60s`);
        await this.delay(60000);
      } else {
        this.logger.error(`Keyword #${keyword.id} erreur: ${err.message}`);
      }
    }
  }

  async backfill(keywordId?: number, pages = 20): Promise<{ keyword: string; pages: number; inserted: number }[]> {
    const allKeywords = await this.keywordsService.findActive();
    const keywords = keywordId ? allKeywords.filter(kw => kw.id === keywordId) : allKeywords;
    const results: { keyword: string; pages: number; inserted: number }[] = [];

    for (const keyword of keywords) {
      let inserted = 0;
      let completedPages = 0;

      for (let page = 1; page <= pages; page++) {
        try {
          const items = await this.vintedClient.search(
            keyword.search_text,
            keyword.min_price,
            keyword.max_price,
            96,
            page,
            keyword.catalog_id,
          );

          if (items.length === 0) break;

          for (const item of items) {
            const { isNew } = await this.listingsService.upsertListing(item, keyword);
            if (isNew) inserted++;
          }

          completedPages++;
          this.logger.log(`Backfill "${keyword.search_text}" page ${page}/${pages} — ${items.length} annonces`);

          if (page < pages) await this.delay(3000);
        } catch (err: any) {
          if (err.message === 'BANNED') {
            this.logger.warn(`Backfill "${keyword.search_text}" bloqué page ${page} — arrêt`);
            break;
          }
          this.logger.error(`Backfill "${keyword.search_text}" page ${page}: ${err.message}`);
          break;
        }
      }

      results.push({ keyword: keyword.label, pages: completedPages, inserted });
      if (keywords.indexOf(keyword) < keywords.length - 1) await this.delay(5000);
    }

    return results;
  }

  async getStatus() {
    const keywords = await this.keywordsService.findActive();
    const now = Date.now();
    const keywordStatus = keywords.map(kw => {
      const last = this.lastRunAt.get(kw.id) ?? 0;
      const nextRunInMs = Math.max(0, kw.scan_interval_seconds * 1000 - (now - last));
      return {
        id: kw.id,
        label: kw.label,
        lastRunAt: last ? new Date(last) : null,
        nextRunInSeconds: Math.round(nextRunInMs / 1000),
      };
    });
    return {
      isRunning: this.isRunning,
      lastScrapeTime: this.lastScrapeTime,
      activeKeywords: keywords.length,
      keywords: keywordStatus,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

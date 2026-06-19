import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import axios from 'axios';
import { NotificationLog } from './notification-log.entity';
import { Listing } from '../listings/listing.entity';
import { Keyword } from '../keywords/keyword.entity';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string;

  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional()
    @InjectRepository(NotificationLog)
    private readonly logRepo?: Repository<NotificationLog>,
  ) {
    this.token = this.config?.get('TELEGRAM_BOT_TOKEN') ?? process.env.TELEGRAM_BOT_TOKEN ?? '';
  }

  private get configured(): boolean {
    return !!this.token;
  }

  async alreadyNotified(listingId: number, keywordId: number): Promise<boolean> {
    if (!this.logRepo) return false;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await this.logRepo.findOne({
      where: { listing_id: listingId, keyword_id: keywordId, sent_at: MoreThan(since) },
    });
    return !!existing;
  }

  async sendListingAlert(listing: Listing, keyword: Keyword, countryCode: string): Promise<void> {
    const chatId = keyword.user?.telegram_chat_id;
    if (!this.configured) {
      this.logger.warn('Telegram non configuré — alerte ignorée');
      return;
    }
    if (!chatId) {
      this.logger.warn(`Skipping Telegram alert for keyword "${keyword.label}": owner has no telegram_chat_id`);
      return;
    }
    if (await this.alreadyNotified(listing.id, keyword.id)) return;

    const country = countryCode ? countryCode.toUpperCase() : '';
    const caption = [
      `🆕 *${this.escape(listing.title ?? 'Annonce Vinted')}*`,
      ``,
      `💶 *${this.escape(String(listing.price ?? '?'))}€*`,
      listing.brand
        ? `🏷️ ${this.escape(listing.brand)}${listing.condition_label ? ' · ' + this.escape(listing.condition_label) : ''}`
        : '',
      `🔑 _${this.escape(keyword.label)}_${country ? ' · ' + this.escape(country) : ''}`,
      `[Voir l'annonce](${listing.url})`,
    ].filter(Boolean).join('\n');

    try {
      if (listing.photo_url) {
        await axios.post(`https://api.telegram.org/bot${this.token}/sendPhoto`, {
          chat_id: chatId,
          photo: listing.photo_url,
          caption,
          parse_mode: 'MarkdownV2',
        });
      } else {
        await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          chat_id: chatId,
          text: caption,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: false,
        });
      }

      if (this.logRepo) {
        await this.logRepo.save({ listing_id: listing.id, keyword_id: keyword.id });
      }
      this.logger.log(`Alerte Telegram envoyée : listing ${listing.id} / keyword ${keyword.id}`);
    } catch (err: any) {
      this.logger.error(`Erreur Telegram: ${err.response?.data?.description ?? err.message}`);
    }
  }

  async sendTest(chatId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.configured) {
      return { ok: false, error: 'TELEGRAM_BOT_TOKEN manquant' };
    }
    if (!chatId) {
      return { ok: false, error: 'Aucun chat_id fourni' };
    }
    try {
      await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        chat_id: chatId,
        text: '✅ Vinbot connecté — les alertes Vinted arriveront ici\\!',
        parse_mode: 'MarkdownV2',
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.response?.data?.description ?? err.message };
    }
  }

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }
}

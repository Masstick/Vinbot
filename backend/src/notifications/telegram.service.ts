import { Injectable, Logger } from '@nestjs/common';
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
  private readonly chatId: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(NotificationLog)
    private readonly logRepo: Repository<NotificationLog>,
  ) {
    this.token = this.config.get('TELEGRAM_BOT_TOKEN') ?? '';
    this.chatId = this.config.get('TELEGRAM_CHAT_ID') ?? '';
  }

  private get configured(): boolean {
    return !!(this.token && this.chatId);
  }

  async alreadyNotified(listingId: number, keywordId: number): Promise<boolean> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await this.logRepo.findOne({
      where: { listing_id: listingId, keyword_id: keywordId, sent_at: MoreThan(since) },
    });
    return !!existing;
  }

  async sendDealAlert(listing: Listing, keyword: Keyword, dealScore: number, marketAvg: number, potentialProfit: number): Promise<void> {
    if (!this.configured) {
      this.logger.warn('Telegram non configuré — alerte ignorée');
      return;
    }

    if (await this.alreadyNotified(listing.id, keyword.id)) return;

    const caption = [
      `🔥 *${this.escape(listing.title ?? 'Annonce Vinted')}*`,
      ``,
      `💶 ${listing.price}€  _(moy\\. marché : ${marketAvg.toFixed(0)}€)_`,
      `💰 Marge potentielle : *+${potentialProfit.toFixed(0)}€* \\(${dealScore.toFixed(0)}% sous la moyenne\\)`,
      `🚚 Frais estimés : ${keyword.shipping_estimate}€`,
      listing.brand ? `🏷️ ${this.escape(listing.brand)}${listing.condition_label ? ' · ' + this.escape(listing.condition_label) : ''}` : '',
      ``,
      `🔑 Mot\\-clé : _${this.escape(keyword.label)}_`,
      `[Voir l'annonce](${listing.url})`,
    ].filter(Boolean).join('\n');

    try {
      if (listing.photo_url) {
        await axios.post(`https://api.telegram.org/bot${this.token}/sendPhoto`, {
          chat_id: this.chatId,
          photo: listing.photo_url,
          caption,
          parse_mode: 'MarkdownV2',
        });
      } else {
        await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          chat_id: this.chatId,
          text: caption,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: false,
        });
      }

      await this.logRepo.save({ listing_id: listing.id, keyword_id: keyword.id });
      this.logger.log(`Alerte Telegram envoyée : listing ${listing.id} / keyword ${keyword.id}`);
    } catch (err: any) {
      this.logger.error(`Erreur Telegram: ${err.response?.data?.description ?? err.message}`);
    }
  }

  async sendTest(): Promise<{ ok: boolean; error?: string }> {
    if (!this.configured) return { ok: false, error: 'TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID manquant' };
    try {
      await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        chat_id: this.chatId,
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

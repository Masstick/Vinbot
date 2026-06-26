// backend/src/accounts/vinted-connect.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser } from 'playwright-core';
import { AccountsService } from './accounts.service';

const AUTH_COOKIES = ['access_token_web', '_vinted_fr_session'];

/** Helper pur : l'utilisateur est-il loggé d'après ses cookies ? */
export function isLoggedIn(cookies: { name: string }[]): boolean {
  return cookies.some((c) => AUTH_COOKIES.includes(c.name));
}

/** Helper pur : sérialise un storageState minimal { cookies, origins }. */
export function buildSessionJson(cookies: any[], origins: any[]): string {
  return JSON.stringify({ cookies, origins });
}

@Injectable()
export class VintedConnectService {
  private readonly logger = new Logger(VintedConnectService.name);

  constructor(
    private readonly accounts: AccountsService,
    private readonly config: ConfigService,
  ) {}

  private cdpUrl(): string {
    return this.config.get<string>('CDP_URL', 'http://localhost:9222');
  }

  private async withBrowser<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
    const browser = await chromium.connectOverCDP(this.cdpUrl());
    try {
      return await fn(browser);
    } finally {
      // connectOverCDP : close() détache le client CDP sans tuer le Chromium du sidecar.
      await browser.close();
    }
  }

  /** Recharge la page de login Vinted dans le Chromium streamé. */
  async startConnect(): Promise<{ novncReady: true }> {
    await this.withBrowser(async (browser) => {
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto('https://www.vinted.fr/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    });
    return { novncReady: true };
  }

  /** Détecte le login et capture la session si présent. */
  async detectAndCapture(): Promise<{ connected: boolean; vintedUserId?: number }> {
    return this.withBrowser(async (browser) => {
      try {
        const ctx = browser.contexts()[0];
        if (!ctx) return { connected: false };
        const cookies = await ctx.cookies();
        if (!isLoggedIn(cookies)) return { connected: false };

        // Confirme via l'endpoint user courant, et récupère l'id.
        const page = ctx.pages()[0] ?? (await ctx.newPage());
        const resp = await page.request.get('https://www.vinted.fr/api/v2/users/current').catch(() => null);
        if (!resp || !resp.ok()) return { connected: false };
        const body = await resp.json().catch(() => ({} as any));
        const vintedUserId = Number(body?.user?.id ?? body?.id ?? 0) || 0;
        if (!vintedUserId) return { connected: false };

        const state = await ctx.storageState();
        const sessionJson = buildSessionJson(state.cookies, state.origins);
        await this.accounts.saveSession({ vintedUserId, sessionJson });
        this.logger.log(`Session Vinted capturée (user ${vintedUserId})`);
        return { connected: true, vintedUserId };
      } catch (err) {
        this.logger.warn(`detectAndCapture échoué: ${err instanceof Error ? err.message : String(err)}`);
        return { connected: false };
      }
    });
  }
}

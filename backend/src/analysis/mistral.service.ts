import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { Listing } from '../listings/listing.entity';
import { Keyword } from '../keywords/keyword.entity';

export interface ModelExtraction {
  model_label: string | null;
  confidence: number;
}

export interface DealAnalysisResult {
  scam_risk: 'low' | 'medium' | 'high';
  confidence: number;
  recommendation: 'buy' | 'watch' | 'skip';
  reasoning: string;
}

@Injectable()
export class MistralService implements OnModuleInit {
  private readonly logger = new Logger(MistralService.name);
  private client: AxiosInstance | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const key = this.config.get<string>('MISTRAL_API_KEY');
    if (!key) {
      this.logger.warn('MISTRAL_API_KEY non défini — analyse IA désactivée (mode no-op)');
      return;
    }
    this.client = axios.create({
      baseURL: 'https://api.mistral.ai/v1',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 8000,
    });
    this.logger.log('MistralService initialisé');
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async extractModel(title: string, price: number, searchContext?: string): Promise<ModelExtraction> {
    if (!this.client) return { model_label: null, confidence: 0 };
    try {
      const contextLine = searchContext
        ? `Contexte de recherche: "${searchContext}"\n`
        : '';
      const prompt =
        `Extrait le modèle exact de cet article Vinted en quelques mots normalisés.\n` +
        contextLine +
        `Titre: "${title}"\nPrix: ${price}€\n\n` +
        `Sois très précis sur la génération/version (ex: distinguer "Core i7-8700K" de "Core i7-12700K").\n` +
        `Si le titre ne correspond pas au contexte de recherche ou est trop vague, renvoie {"model_label": null, "confidence": 0.0}.\n` +
        `Réponds uniquement en JSON:\n` +
        `{"model_label": "modèle précis normalisé (ex: Intel Core i7-12700K, RTX 3080 10GB)", "confidence": 0.0-1.0}`;
      const res = await this.client.post('/chat/completions', {
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 100,
      });
      return this.parseExtractResponse(res.data.choices[0].message.content);
    } catch (err: any) {
      if (err.response?.status === 429) {
        this.logger.warn('Mistral rate limit (429) sur extractModel — retry dans 15s');
        await new Promise(r => setTimeout(r, 15_000));
        return this.extractModel(title, price, searchContext);
      }
      this.logger.warn(`extractModel failed: ${err.message}`);
      return { model_label: null, confidence: 0 };
    }
  }

  async analyzeDeal(
    listing: Listing,
    keyword: Keyword,
    marketAvg: number,
    itemCount: number,
  ): Promise<DealAnalysisResult | null> {
    if (!this.client) return null;
    try {
      const price = parseFloat(String(listing.price ?? 0));
      const shippingEst = parseFloat(String(keyword.shipping_estimate)) || 4;
      const potentialProfit = marketAvg - price - shippingEst;
      const modelLabel = (listing as any).model_label ?? null;
      const prompt =
        `Analyse cette annonce Vinted pour un acheteur-revendeur.\n` +
        `Titre: "${listing.title}"\n` +
        `Modèle identifié: ${modelLabel ?? 'inconnu'}\n` +
        `Prix demandé: ${price}€\nÉtat: ${listing.condition_label ?? 'non renseigné'}\n` +
        `Vendeur: ${listing.seller_name ?? 'inconnu'}\n` +
        `Moyenne marché pour "${modelLabel ?? listing.title}": ${marketAvg.toFixed(2)}€ (sur ${itemCount} annonces)\n` +
        `Profit potentiel estimé: ${potentialProfit.toFixed(2)}€\n\n` +
        `Réponds uniquement en JSON:\n` +
        `{"scam_risk":"low|medium|high","confidence":0.0-1.0,"recommendation":"buy|watch|skip","reasoning":"2-3 phrases en français"}`;
      const res = await this.client.post('/chat/completions', {
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 300,
      });
      return this.parseAnalysisResponse(res.data.choices[0].message.content);
    } catch (err: any) {
      if (err.response?.status === 429) {
        this.logger.warn('Mistral rate limit (429) — retry dans 10s');
        await new Promise(r => setTimeout(r, 10_000));
        return this.analyzeDeal(listing, keyword, marketAvg, itemCount);
      }
      this.logger.warn(`analyzeDeal failed: ${err.message}`);
      return null;
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.client) return { ok: false, error: 'MISTRAL_API_KEY non configuré' };
    try {
      await this.client.get('/models');
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  private parseExtractResponse(content: string): ModelExtraction {
    try {
      const parsed = JSON.parse(content);
      return {
        model_label: parsed.model_label ?? null,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      };
    } catch {
      return { model_label: null, confidence: 0 };
    }
  }

  private parseAnalysisResponse(content: string): DealAnalysisResult {
    try {
      const parsed = JSON.parse(content);
      const scamRisk = ['low', 'medium', 'high'].includes(parsed.scam_risk)
        ? (parsed.scam_risk as 'low' | 'medium' | 'high')
        : 'low';
      const recommendation = ['buy', 'watch', 'skip'].includes(parsed.recommendation)
        ? (parsed.recommendation as 'buy' | 'watch' | 'skip')
        : 'skip';
      return {
        scam_risk: scamRisk,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        recommendation,
        reasoning: parsed.reasoning ?? '',
      };
    } catch {
      return { scam_risk: 'low', confidence: 0, recommendation: 'skip', reasoning: '' };
    }
  }
}

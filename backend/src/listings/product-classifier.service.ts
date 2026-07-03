import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { classifyTitle } from './classifier-rules';

@Injectable()
export class ProductClassifierService {
  private readonly logger = new Logger(ProductClassifierService.name);

  constructor(@Optional() private readonly config?: ConfigService) {}

  private get mistralKey(): string {
    return this.config?.get('MISTRAL_API_KEY') ?? process.env.MISTRAL_API_KEY ?? '';
  }

  classifyByRules(title: string): string | null {
    return classifyTitle(title);
  }

  async classifyWithMistral(title: string): Promise<string | null> {
    const key = this.mistralKey;
    if (!key) return null;
    try {
      const res = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        {
          model: 'mistral-small-latest',
          temperature: 0,
          messages: [
            {
              role: 'user',
              content:
                `Extrais le type de produit générique (caractéristiques techniques ` +
                `uniquement, sans marque) depuis ce titre d'annonce Vinted : "${title}". ` +
                `Réponds uniquement avec le type de produit court (ex: "RAM DDR4 8GB", ` +
                `"Carte mère ATX"), ou "INCONNU" si le titre ne décrit pas un composant PC identifiable.`,
            },
          ],
        },
        { headers: { Authorization: `Bearer ${key}` }, timeout: 10_000 },
      );
      const text: string | undefined = res.data?.choices?.[0]?.message?.content?.trim();
      if (!text || text.toUpperCase().includes('INCONNU')) return null;
      return text;
    } catch (err: any) {
      this.logger.warn(`Classification Mistral échouée pour "${title}": ${err.message}`);
      return null;
    }
  }
}

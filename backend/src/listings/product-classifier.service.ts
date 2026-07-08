import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { classifyTitle, isValidProductTypeKey } from './classifier-rules';

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
                `Extrais le type de produit depuis ce titre d'annonce Vinted : "${title}". ` +
                `Réponds STRICTEMENT dans un de ces formats exacts (respecte espaces et casse), ` +
                `sans marque ni mot en plus :\n` +
                `- RAM : "RAM DDR<2-5> <capacité>GB" (ex: "RAM DDR4 8GB")\n` +
                `- CPU Intel : "CPU i<3/5/7/9>-<référence>" (ex: "CPU i7-4790K")\n` +
                `- CPU AMD : "CPU Ryzen <série> <référence>" (ex: "CPU Ryzen 5 3600")\n` +
                `- Carte graphique : "GPU RTX/GTX/GT/RX <modèle>[ Ti/Super/XT]", sans "Nvidia"/"AMD" ` +
                `(ex: "GPU RTX 3070 Ti", "GPU RX 580")\n` +
                `- Carte mère : "Carte mère <chipset>" (ex: "Carte mère B450"), juste le chipset, sans marque\n` +
                `- Stockage : "SSD/HDD/NVMe <capacité>GB ou TB" (ex: "SSD 500GB", "NVMe 1TB")\n` +
                `Si le titre ne permet pas de déterminer précisément une référence/capacité dans un de ` +
                `ces formats, réponds uniquement "INCONNU" — ne réponds jamais un type vague ` +
                `(ex: pas de simple "GPU" ou "GPU 8GB" sans référence de modèle).`,
            },
          ],
        },
        { headers: { Authorization: `Bearer ${key}` }, timeout: 10_000 },
      );
      const text: string | undefined = res.data?.choices?.[0]?.message?.content?.trim();
      if (!text || text.toUpperCase().includes('INCONNU')) return null;
      if (!isValidProductTypeKey(text)) {
        this.logger.warn(`Mistral a répondu hors format pour "${title}" : "${text}"`);
        return null;
      }
      return text;
    } catch (err: any) {
      this.logger.warn(`Classification Mistral échouée pour "${title}": ${err.message}`);
      return null;
    }
  }
}

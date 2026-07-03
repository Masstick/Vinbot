import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { truncatedMean } from './truncated-mean';

export interface ProductTypeStatsResult {
  avgPrice: number;
  itemCount: number;
}

@Injectable()
export class ProductTypeStatsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Recalcule la moyenne tronquée du groupe à partir de tous les prix connus,
   *  et upsert le résultat dans product_type_stats. Coût négligeable : le volume
   *  par groupe (type de produit) reste de l'ordre de la centaine d'annonces. */
  async recompute(keywordId: number, productTypeKey: string): Promise<ProductTypeStatsResult> {
    const rows = await this.dataSource.query(
      `SELECT l.price FROM listings l
       INNER JOIN keyword_listings kl ON kl.listing_id = l.id
       WHERE kl.keyword_id = $1 AND l.product_type_key = $2 AND l.price IS NOT NULL`,
      [keywordId, productTypeKey],
    );
    const prices = rows.map((r: any) => parseFloat(r.price));
    const avgPrice = truncatedMean(prices);
    const itemCount = prices.length;
    await this.dataSource.query(
      `INSERT INTO product_type_stats (keyword_id, product_type_key, avg_price, item_count, last_updated)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (keyword_id, product_type_key)
       DO UPDATE SET avg_price = $3, item_count = $4, last_updated = NOW()`,
      [keywordId, productTypeKey, avgPrice, itemCount],
    );
    return { avgPrice, itemCount };
  }
}

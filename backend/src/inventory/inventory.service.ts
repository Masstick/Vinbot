import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity';
import { SellerListing } from './seller-listing.entity';
import { Sale } from './sale.entity';
import { SellerItem, SaleRecord } from './vinted-seller.client';

export interface InventoryFilters {
  brand?: string; size?: string; category?: string; priceMin?: number; priceMax?: number;
}
export type InventoryRow = SellerListing & {
  brand: string | null; size_label: string | null; category: string | null;
  purchase_price: number | null; margin: number | null;
};

/** Helper pur : marge = prix de vente - prix d'achat, ou null si incomplet. */
export function computeMargin(salePrice: number | null, purchasePrice: number | null): number | null {
  if (salePrice == null || purchasePrice == null) return null;
  return Number((salePrice - purchasePrice).toFixed(2));
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(SellerListing) private readonly listings: Repository<SellerListing>,
    @InjectRepository(Sale) private readonly sales: Repository<Sale>,
  ) {}

  async upsertListing(accountId: number, item: SellerItem): Promise<SellerListing> {
    let row = await this.listings.findOne({ where: { vinted_id: item.vinted_id } });
    if (!row) {
      const product = await this.products.save(
        this.products.create({
          account_id: accountId, title: item.title, brand: item.brand,
          size_label: item.size_label, condition_label: item.condition_label,
          category: item.category,
        }),
      );
      row = this.listings.create({ account_id: accountId, vinted_id: item.vinted_id, product_id: product.id });
    }
    row.url = item.url;
    row.price = item.price;
    row.status = item.status;
    row.view_count = item.view_count;
    row.favourite_count = item.favourite_count;
    row.photo_url = item.photo_url;
    row.vinted_created_at = item.vinted_created_at;
    row.last_synced_at = new Date();
    return this.listings.save(row);
  }

  async upsertSale(accountId: number, rec: SaleRecord): Promise<Sale> {
    const orderId = rec.vinted_order_id != null && !Number.isNaN(rec.vinted_order_id) ? rec.vinted_order_id : null;
    let row = orderId != null
      ? await this.sales.findOne({ where: { vinted_order_id: orderId } })
      : null;
    if (!row) row = this.sales.create({ account_id: accountId, vinted_order_id: orderId });
    row.buyer_name = rec.buyer_name;
    row.sale_price = rec.sale_price;
    row.shipping_status = rec.shipping_status;
    row.sold_at = rec.sold_at;
    if (rec.vinted_item_id != null && !Number.isNaN(rec.vinted_item_id)) {
      const listing = await this.listings.findOne({ where: { vinted_id: rec.vinted_item_id } });
      if (listing) row.seller_listing_id = listing.id;
    }
    return this.sales.save(row);
  }

  async listInventory(filters: InventoryFilters): Promise<InventoryRow[]> {
    const qb = this.listings.createQueryBuilder('l')
      .leftJoin(Product, 'p', 'p.id = l.product_id')
      .select('l.*')
      .addSelect('p.brand', 'brand')
      .addSelect('p.size_label', 'size_label')
      .addSelect('p.category', 'category')
      .addSelect('p.purchase_price', 'purchase_price')
      .orderBy('l.last_synced_at', 'DESC');

    if (filters.brand) qb.andWhere('p.brand ILIKE :brand', { brand: `%${filters.brand}%` });
    if (filters.size) qb.andWhere('p.size_label ILIKE :size', { size: `%${filters.size}%` });
    if (filters.category) qb.andWhere('p.category ILIKE :cat', { cat: `%${filters.category}%` });
    if (filters.priceMin != null) qb.andWhere('l.price >= :pmin', { pmin: filters.priceMin });
    if (filters.priceMax != null) qb.andWhere('l.price <= :pmax', { pmax: filters.priceMax });

    const rows = await qb.getRawMany();
    return rows.map((r) => {
      const price = r.price != null ? Number(r.price) : null;
      const purchase_price = r.purchase_price != null ? Number(r.purchase_price) : null;
      return { ...r, price, purchase_price, margin: computeMargin(price, purchase_price) };
    }) as InventoryRow[];
  }

  async listSales(): Promise<Sale[]> {
    return this.sales.find({ order: { sold_at: 'DESC' } });
  }

  async setPurchasePrice(productId: number, price: number | null): Promise<void> {
    await this.products.update(productId, { purchase_price: price, updated_at: new Date() });
  }

  /** Marque DELETED les annonces du compte non revues depuis `since` (hors SOLD/DELETED). */
  async markUnseenAsDeleted(accountId: number, since: Date): Promise<number> {
    const res = await this.listings
      .createQueryBuilder()
      .update(SellerListing)
      .set({ status: 'DELETED' })
      .where('account_id = :accountId', { accountId })
      .andWhere('status NOT IN (:...kept)', { kept: ['SOLD', 'DELETED'] })
      .andWhere('(last_synced_at IS NULL OR last_synced_at < :since)', { since })
      .execute();
    return res.affected ?? 0;
  }
}

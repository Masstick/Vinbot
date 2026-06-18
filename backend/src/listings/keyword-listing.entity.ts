import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Keyword } from '../keywords/keyword.entity';
import { Listing } from './listing.entity';

@Entity('keyword_listings')
export class KeywordListing {
  @PrimaryColumn()
  keyword_id: number;

  @PrimaryColumn()
  listing_id: number;

  @ManyToOne(() => Keyword, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'keyword_id' })
  keyword: Keyword;

  @ManyToOne(() => Listing, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing: Listing;

  @CreateDateColumn()
  matched_at: Date;

  /** Nb d'annonces actives du vendeur correspondant au mot-clé (profil Vinted). Null = pas encore vérifié. */
  @Column({ type: 'int', nullable: true })
  seller_item_count: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  seller_checked_at: Date | null;
}

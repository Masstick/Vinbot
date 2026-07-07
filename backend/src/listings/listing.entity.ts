import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('listings')
export class Listing {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint', unique: true })
  vinted_id: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  title: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price: number | null;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ type: 'text', nullable: true })
  photo_url: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  size_label: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  condition_label: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  seller_name: string | null;

  @Column({ type: 'bigint', nullable: true })
  seller_id: number | null;

  @Column({ type: 'varchar', length: 5, nullable: true, default: 'fr' })
  country_code: string | null;

  /** Pays réel du vendeur (ISO, depuis son profil Vinted). Null tant que non vérifié. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  seller_country: string | null;

  @Column({ type: 'int', nullable: true })
  view_count: number | null;

  @Column({ type: 'int', nullable: true })
  favourite_count: number | null;

  @CreateDateColumn()
  first_seen_at: Date;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  last_seen_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  vinted_created_at: Date | null;

  /** Date de détection comme vendue/supprimée (null = disponible, affichée). */
  @Column({ type: 'timestamptz', nullable: true })
  unavailable_at: Date | null;

  /** Raison d'indisponibilité : 'sold' (vendue/fermée) ou 'gone' (404 supprimée). */
  @Column({ type: 'varchar', length: 10, nullable: true })
  unavailable_reason: string | null;

  /** Dernière vérification de disponibilité via l'item API (null = jamais vérifiée). */
  @Column({ type: 'timestamptz', nullable: true })
  availability_checked_at: Date | null;

  /** Type de produit normalisé (règles ou Mistral). Null = pas encore classé, 'unclassified' = abandonné après 3 échecs Mistral. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  product_type_key: string | null;

  /** Nombre de tentatives de classification Mistral (plafonné à 3, voir ScraperService). */
  @Column({ type: 'smallint', default: 0 })
  product_type_attempts: number;

  /** Description complète et galerie photos, récupérées à la demande (voir ScraperService.getListingDetails). */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', array: true, nullable: true })
  photo_urls: string[] | null;

  /** Null tant que la fiche détail n'a jamais été ouverte (pas encore de tentative de récupération). */
  @Column({ type: 'timestamptz', nullable: true })
  details_fetched_at: Date | null;
}

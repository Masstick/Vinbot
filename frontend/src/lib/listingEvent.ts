export interface ListingEvent {
  listingId: number;
  title: string;
  price: number;
  photoUrl: string | null;
  url: string | null;
  keywordLabel: string;
  vintedCreatedAt: string | null;
  userId: number;
  avgPrice: number | null;
  dealScore: number | null;
  isDeal: boolean;
}

export interface DealUpdatedEvent {
  listingId: number;
  avgPrice: number | null;
  dealScore: number | null;
  isDeal: boolean;
}

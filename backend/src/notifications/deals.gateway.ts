import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

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

@WebSocketGateway({ cors: { origin: '*' } })
export class DealsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(DealsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client WS connecté : ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client WS déconnecté : ${client.id}`);
  }

  emitNewListing(payload: ListingEvent) {
    this.server.emit('new-listing', payload);
    this.logger.log(`📡 Listing émis WS : "${payload.title}" — ${payload.price}€`);
  }

  /** Classification différée (sweep Mistral) : met à jour une carte déjà affichée. */
  emitDealUpdated(payload: DealUpdatedEvent) {
    this.server.emit('deal-updated', payload);
    this.logger.log(`📡 Deal mis à jour WS : listing ${payload.listingId} — isDeal=${payload.isDeal}`);
  }

  emitKeywordChanged() {
    this.server.emit('keyword-changed');
  }
}

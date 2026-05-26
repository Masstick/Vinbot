import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

/**
 * Gateway WebSocket pour pousser les alertes deal en temps réel
 * vers les clients connectés (dashboard Next.js).
 * Écoute sur le même port que l'API HTTP (CORS * pour dev).
 */
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

  /**
   * Émet un événement "new-deal" vers tous les clients connectés.
   * Appelé par le ScraperService dès qu'un deal rentable est détecté.
   */
  emitNewDeal(payload: {
    listingId: number;
    title: string;
    price: number;
    marketAvg: number;
    profit: number;
    dealScore: number;
    photoUrl: string | null;
    url: string | null;
    keywordLabel: string;
  }) {
    this.server.emit('new-deal', payload);
    this.logger.log(`📡 Deal émis WS : "${payload.title}" → +${payload.profit.toFixed(0)}€`);
  }
}

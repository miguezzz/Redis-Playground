import { Injectable } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface SubscribePayload {
  showId: string;
  ticketId: string;
}

const room = (showId: string, ticketId: string) => `t:${showId}:${ticketId}`;

@Injectable()
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class QueueGateway {
  @WebSocketServer() server!: Server;

  @SubscribeMessage('subscribe')
  onSubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: SubscribePayload,
  ) {
    if (!body?.showId || !body?.ticketId) return { ok: false };
    socket.join(room(body.showId, body.ticketId));
    return { ok: true };
  }

  emitPosition(
    showId: string,
    ticketId: string,
    payload: { position: number; total: number },
  ) {
    this.server.to(room(showId, ticketId)).emit('position', payload);
  }

  emitYourTurn(showId: string, ticketId: string) {
    this.server.to(room(showId, ticketId)).emit('your-turn', { showId, ticketId });
  }

  broadcastSeatUpdate(showId: string, payload: any) {
    this.server.emit(`seats:${showId}`, payload);
  }

  broadcastAdminState(showId: string, payload: any) {
    this.server.emit(`admin-state:${showId}`, payload);
  }
}

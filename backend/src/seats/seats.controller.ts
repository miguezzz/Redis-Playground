import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SeatsService } from './seats.service';
import { QueueGateway } from '../queue/queue.gateway';

@Controller('seats')
export class SeatsController {
  constructor(
    private readonly seats: SeatsService,
    private readonly gateway: QueueGateway,
  ) {}

  @Get(':showId')
  state(@Param('showId') showId: string) {
    return this.seats.state(showId);
  }

  @Post(':showId/hold')
  async hold(
    @Param('showId') showId: string,
    @Body() body: { ticketId: string; seatId: string },
  ) {
    const result = await this.seats.hold(showId, body.ticketId, body.seatId);
    this.gateway.broadcastSeatUpdate(showId, { seatId: body.seatId, state: 'held' });
    return result;
  }

  @Post(':showId/release')
  async release(
    @Param('showId') showId: string,
    @Body() body: { ticketId: string; seatId: string },
  ) {
    const result = await this.seats.release(showId, body.ticketId, body.seatId);
    this.gateway.broadcastSeatUpdate(showId, { seatId: body.seatId, state: 'free' });
    return result;
  }

  @Post(':showId/confirm')
  async confirm(
    @Param('showId') showId: string,
    @Body() body: { ticketId: string; seatId: string },
  ) {
    const result = await this.seats.confirm(showId, body.ticketId, body.seatId);
    this.gateway.broadcastSeatUpdate(showId, { seatId: body.seatId, state: 'sold' });
    return result;
  }
}

import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { QueueService } from './queue.service';

@Controller('queue')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  @Post(':showId/join')
  join(@Param('showId') showId: string) {
    return this.queue.join(showId);
  }

  @Get(':showId/:ticketId')
  status(
    @Param('showId') showId: string,
    @Param('ticketId') ticketId: string,
  ) {
    return this.queue.status(showId, ticketId);
  }

  @Delete(':showId/:ticketId')
  leave(
    @Param('showId') showId: string,
    @Param('ticketId') ticketId: string,
  ) {
    return this.queue.leave(showId, ticketId).then(() => ({ ok: true }));
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueService } from './queue.service';
import { QueueGateway } from './queue.gateway';
import { ShowsService } from '../shows/shows.service';

export const ADMISSION_QUEUE = 'admission';

@Processor(ADMISSION_QUEUE)
export class AdmissionProcessor extends WorkerHost {
  constructor(
    private readonly queue: QueueService,
    private readonly gateway: QueueGateway,
    private readonly shows: ShowsService,
  ) {
    super();
  }

  async process(_job: Job) {
    for (const show of this.shows.list()) {
      const admitted = await this.queue.admit(show.id);
      for (const ticketId of admitted) {
        this.gateway.emitYourTurn(show.id, ticketId);
      }
      const waitingIds = await this.queue.listWaitingTicketIds(show.id);
      waitingIds.forEach((ticketId, idx) => {
        this.gateway.emitPosition(show.id, ticketId, {
          position: idx + 1,
          total: waitingIds.length,
        });
      });
    }
  }
}

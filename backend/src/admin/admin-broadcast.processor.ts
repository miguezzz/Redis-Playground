import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AdminStateService } from './admin-state.service';
import { ShowsService } from '../shows/shows.service';
import { QueueGateway } from '../queue/queue.gateway';

export const ADMIN_BROADCAST_QUEUE = 'admin-broadcast';

@Processor(ADMIN_BROADCAST_QUEUE)
export class AdminBroadcastProcessor extends WorkerHost {
  constructor(
    private readonly state: AdminStateService,
    private readonly shows: ShowsService,
    private readonly gateway: QueueGateway,
  ) {
    super();
  }

  async process(_job: Job) {
    for (const show of this.shows.list()) {
      const snapshot = await this.state.snapshot(show.id);
      this.gateway.broadcastAdminState(show.id, snapshot);
    }
  }
}

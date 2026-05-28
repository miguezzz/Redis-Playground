import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueModule } from '../queue/queue.module';
import { SeatsModule } from '../seats/seats.module';
import { ShowsModule } from '../shows/shows.module';
import { AdminController } from './admin.controller';
import { AdminStateService } from './admin-state.service';
import {
  AdminBroadcastProcessor,
  ADMIN_BROADCAST_QUEUE,
} from './admin-broadcast.processor';

@Module({
  imports: [
    ShowsModule,
    QueueModule,
    SeatsModule,
    BullModule.registerQueue({ name: ADMIN_BROADCAST_QUEUE }),
  ],
  providers: [AdminStateService, AdminBroadcastProcessor],
  controllers: [AdminController],
  exports: [AdminStateService],
})
export class AdminModule implements OnModuleInit {
  private readonly intervalMs = Number(process.env.ADMIT_INTERVAL_MS) || 1000;

  constructor(
    @InjectQueue(ADMIN_BROADCAST_QUEUE) private readonly q: Queue,
  ) {}

  async onModuleInit() {
    await this.q.add(
      'broadcast-tick',
      {},
      {
        repeat: { every: this.intervalMs },
        removeOnComplete: true,
        removeOnFail: 20,
      },
    );
  }
}

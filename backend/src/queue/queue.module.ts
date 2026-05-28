import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { QueueGateway } from './queue.gateway';
import { AdmissionProcessor, ADMISSION_QUEUE } from './queue.processor';
import { ShowsModule } from '../shows/shows.module';

@Module({
  imports: [
    ShowsModule,
    BullModule.registerQueue({ name: ADMISSION_QUEUE }),
  ],
  providers: [QueueService, QueueGateway, AdmissionProcessor],
  controllers: [QueueController],
  exports: [QueueService, QueueGateway],
})
export class QueueModule implements OnModuleInit {
  private readonly intervalMs = Number(process.env.ADMIT_INTERVAL_MS) || 1000;

  constructor(
    @InjectQueue(ADMISSION_QUEUE) private readonly admitQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.admitQueue.add(
      'admit-tick',
      {},
      {
        repeat: { every: this.intervalMs },
        removeOnComplete: true,
        removeOnFail: 20,
      },
    );
    console.log(`[queue] admit job every ${this.intervalMs}ms`);
  }
}

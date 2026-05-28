import { NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { ExpressAdapter as BoardExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import type { Queue } from 'bullmq';
import { AppModule } from './app.module';
import { ADMISSION_QUEUE } from './queue/queue.processor';
import { ADMIN_BROADCAST_QUEUE } from './admin/admin-broadcast.processor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });

  const admission = app.get<Queue>(getQueueToken(ADMISSION_QUEUE));
  const broadcast = app.get<Queue>(getQueueToken(ADMIN_BROADCAST_QUEUE));
  const boardAdapter = new BoardExpressAdapter();
  boardAdapter.setBasePath('/admin/queues');
  createBullBoard({
    queues: [new BullMQAdapter(admission), new BullMQAdapter(broadcast)],
    serverAdapter: boardAdapter,
  });
  app.use('/admin/queues', boardAdapter.getRouter());

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`backend up on :${port}`);
  console.log(`bull-board → http://localhost:${port}/admin/queues`);
}
bootstrap();

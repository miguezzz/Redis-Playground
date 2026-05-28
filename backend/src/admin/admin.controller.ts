import { Controller, Get, Param, Post } from '@nestjs/common';
import { AdminStateService } from './admin-state.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminStateService) {}

  @Get('state/:showId')
  getState(@Param('showId') showId: string) {
    return this.admin.snapshot(showId);
  }

  @Post('reset/:showId')
  async reset(@Param('showId') showId: string) {
    await this.admin.resetShow(showId);
    return { ok: true };
  }
}

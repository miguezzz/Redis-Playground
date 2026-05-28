import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ShowsService } from './shows.service';

@Controller('shows')
export class ShowsController {
  constructor(private readonly shows: ShowsService) {}

  @Get()
  list() {
    return this.shows.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const show = this.shows.get(id);
    if (!show) throw new NotFoundException();
    return { ...show, seats: this.shows.seatIds(id) };
  }
}

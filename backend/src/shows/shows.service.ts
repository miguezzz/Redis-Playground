import { Injectable } from '@nestjs/common';

export interface Show {
  id: string;
  name: string;
  rows: number;
  cols: number;
}

@Injectable()
export class ShowsService {
  private shows: Show[] = [
    { id: 'foo-fighters', name: 'Foo Fighters — Allianz Parque', rows: 6, cols: 10 },
    { id: 'dune-imax', name: 'Dune Part II (IMAX)', rows: 5, cols: 8 },
  ];

  list() {
    return this.shows;
  }

  get(id: string) {
    return this.shows.find((s) => s.id === id);
  }

  seatIds(id: string): string[] {
    const show = this.get(id);
    if (!show) return [];
    const out: string[] = [];
    for (let r = 0; r < show.rows; r++) {
      const letter = String.fromCharCode(65 + r);
      for (let c = 1; c <= show.cols; c++) out.push(`${letter}${c}`);
    }
    return out;
  }
}

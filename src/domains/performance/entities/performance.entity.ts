import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('performances')
export class Performance {
  @PrimaryColumn()
  id: string;

  @Column()
  title: string;

  @Column()
  genre: string;

  @Column({ type: 'date' })
  start_date: Date;

  @Column({ type: 'date' })
  end_date: Date;

  @Column()
  status: string;

  @Column({ type: 'text', nullable: true })
  synopsis: string;

  @Column({ name: 'poster_url', nullable: true })
  posterUrl: string;
}

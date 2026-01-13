import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('performances')
export class Performance {
  @PrimaryColumn()
  id: string; // 소스측 ID

  @Column()
  source: string; // 'KOPIS' | 'CULTURE'

  @Column()
  type: string; // 'THEATER', 'MUSICAL', 'EXHIBITION', 'FESTIVAL'

  @Column()
  title: string;

  @Column({ type: 'date' })
  start_date: Date;

  @Column({ type: 'date' })
  end_date: Date;

  @Column()
  place_name: string;

  @Column({ nullable: true })
  poster_url: string;

  @Column({ nullable: true })
  genre: string;

  @Column({ nullable: true })
  status: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  ticket_link: string;

  @UpdateDateColumn()
  updated_at: Date;
}

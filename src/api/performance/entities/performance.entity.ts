import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('performances')
export class Performance {
  @PrimaryColumn()
  id: string; // 소스측 ID

  @Column()
  source: string; // 'KOPIS'

  @Column()
  type: string; // 'THEATER', 'MUSICAL'

  @Column()
  title: string; // 공연 제목

  @Column({ type: 'date' })
  start_date: Date; // 공연 시작일

  @Column({ type: 'date' })
  end_date: Date; // 공연 종료일

  @Column({ nullable: true })
  time_info: string; // 공연 시간 안내 (예: "화~금 19:30 / 주말 15:00")

  @Column()
  place_name: string; // 장소명

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: number; // 위도

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: number; // 경도

  @Column({ nullable: true })
  price: string; // 티켓 가격 정보

  @Column({ nullable: true })
  poster_url: string; // 포스터 정보 URL

  @Column({ nullable: true })
  genre: string; // 상세 장르 (예: '드라마', '클래식')

  @Column({ nullable: true })
  status: string; // 공연 상태 ('공연중', '공연예정')

  @Column({ type: 'text', nullable: true })
  description: string; // 줄거리 및 상세 내용

  @Column({ type: 'text', nullable: true })
  ticket_link: string; // 티켓링크

  @Column({
    type: 'text',
    nullable: true,
    comment:
      'Description embedding vector for RAG search (stored as text, cast to vector in queries)',
  })
  embedding?: string; // pgvector: description 임베딩 벡터 (text로 저장, 쿼리에서 vector로 캐스팅)

  @UpdateDateColumn()
  updated_at: Date; // 마지막 데이터 업데이트 시각
}

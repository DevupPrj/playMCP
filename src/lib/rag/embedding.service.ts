import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmbeddingService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * 자연어 쿼리를 벡터 임베딩으로 변환
   * @param text 자연어 텍스트
   * @returns 벡터 배열
   */
  async embed(text: string): Promise<number[]> {
    // TODO: OpenAI API 또는 로컬 임베딩 모델 사용
    // 예시: OpenAI embeddings API
    // const response = await openai.embeddings.create({
    //   model: 'text-embedding-ada-002',
    //   input: text,
    // });
    // return response.data[0].embedding;

    // 임시 더미 벡터 (실제 구현 필요)
    return new Array(1536).fill(0).map(() => Math.random());
  }

  /**
   * 여러 텍스트를 일괄 임베딩
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

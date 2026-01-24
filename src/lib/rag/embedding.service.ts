import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly openai: OpenAI | null = null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({
        apiKey: apiKey,
      });
      this.logger.log('✅ OpenAI EmbeddingService 초기화 완료');
    } else {
      this.logger.warn(
        '⚠️ OPENAI_API_KEY가 없습니다. 임베딩 기능이 제한됩니다.',
      );
    }
  }

  /**
   * 자연어 텍스트를 벡터 임베딩으로 변환
   * @param text 자연어 텍스트
   * @returns 벡터 배열 (1536차원)
   */
  async embed(text: string): Promise<number[]> {
    if (!this.openai) {
      this.logger.warn('OpenAI API Key 없음 - 더미 벡터 반환');
      return new Array(1536).fill(0).map(() => Math.random());
    }

    if (!text || text.trim().length === 0) {
      this.logger.warn('빈 텍스트 - 더미 벡터 반환');
      return new Array(1536).fill(0);
    }

    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text.trim(),
      });

      return response.data[0].embedding;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown Error';
      this.logger.error(`OpenAI 임베딩 생성 실패: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * 여러 텍스트를 일괄 임베딩 (배치 처리)
   * @param texts 텍스트 배열
   * @returns 벡터 배열의 배열
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.openai) {
      this.logger.warn('OpenAI API Key 없음 - 더미 벡터 반환');
      return texts.map(() => new Array(1536).fill(0).map(() => Math.random()));
    }

    if (texts.length === 0) {
      return [];
    }

    // 빈 텍스트 필터링
    const validTexts = texts
      .map((text, index) => ({ text: text?.trim(), index }))
      .filter((item) => item.text && item.text.length > 0);

    if (validTexts.length === 0) {
      return texts.map(() => new Array(1536).fill(0));
    }

    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: validTexts.map((item) => item.text),
      });

      // 원본 배열 순서대로 매핑 (빈 텍스트는 더미 벡터)
      const embeddings: number[][] = [];
      let validIndex = 0;

      for (let i = 0; i < texts.length; i++) {
        if (validTexts[validIndex] && validTexts[validIndex].index === i) {
          embeddings.push(response.data[validIndex].embedding);
          validIndex++;
        } else {
          embeddings.push(new Array(1536).fill(0));
        }
      }

      return embeddings;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown Error';
      this.logger.error(`OpenAI 배치 임베딩 생성 실패: ${errorMessage}`);
      throw error;
    }
  }
}

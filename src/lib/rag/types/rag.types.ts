export interface VectorSearchFilters {
  status?: string;
  place?: string;
  genre?: string;
  date?: string;
}

export interface VectorSearchResult<T = any> {
  data: T;
  similarity: number;
}

export interface EmbeddingOptions {
  model?: string;
  dimensions?: number;
}

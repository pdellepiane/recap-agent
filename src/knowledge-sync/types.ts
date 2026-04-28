export interface ScrapedArticle {
  title: string;
  slug: string;
  category: string;
  content: string;
  updatedAt: string | null;
}

export interface ScrapedCategory {
  name: string;
  slug: string;
  articleCount: number;
}

export interface KnowledgeBaseSyncConfig {
  baseUrl: string;
  outputPath: string;
  openAiApiKey: string;
  vectorStoreName: string;
  vectorStoreId: string | null;
}

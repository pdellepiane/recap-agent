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

export interface ArticleMetadata {
  title: string;
  slug: string;
  category: string;
  articleType: string;
  tags: string[];
  sourceUrl: string;
  lastUpdated: string | null;
  relatedTopics: string[];
}

export interface FormattedArticle {
  metadata: ArticleMetadata;
  markdown: string;
}

export interface KnowledgeBaseSyncConfig {
  baseUrl: string;
  outputDir: string;
  openAiApiKey: string;
  vectorStoreName: string;
  vectorStoreId: string | null;
}

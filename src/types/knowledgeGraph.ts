export type KnowledgeGraphNodeType = 'paper' | 'note' | 'tag' | 'category' | 'reference';

export type KnowledgeGraphEdgeType =
  | 'paper_tag'
  | 'note_tag'
  | 'paper_category'
  | 'note_link'
  | 'note_paper'
  | 'related_by_embedding'
  | 'paper_cites_paper'
  | 'paper_reference'
  | 'co_author'
  | 'custom_relation';

export interface KnowledgeGraphNode {
  id: string;
  type: KnowledgeGraphNodeType;
  label: string;
  subtitle?: string;
  paperId?: string;
  noteId?: string;
  tag?: string;
  categoryId?: string;
  referenceId?: string;
  doi?: string;
  year?: string | null;
  categoryIds?: string[];
  degree?: number;
  /** 论文节点按主分类着色的确定性颜色；无分类为中性灰。 */
  color?: string;
  size?: number;
  score?: number;
}

export interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  type: KnowledgeGraphEdgeType;
  label: string;
  description?: string;
  confidence?: number;
  weight?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface GraphQuality {
  nodeCount: number;
  edgeCount: number;
  degreeMin: number;
  degreeMedian: number;
  degreeMax: number;
  componentCount: number;
  isolatedCount: number;
  hubnessSkew: number;
  semanticCoverage: { indexed: number; total: number };
  geometryVersion: string;
}

export interface KnowledgeGraphSnapshot {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  generatedAt: number;
  metadata?: {
    sampled?: boolean;
    truncated?: boolean;
    nodeLimit?: number;
    edgeLimitPerNode?: number;
    totalNodes?: number;
    returnedNodes?: number;
    totalEdges?: number;
    returnedEdges?: number;
    graphQuality?: GraphQuality;
  };
}

export interface KnowledgeGraphRequest {
  includePapers?: boolean;
  includeNotes?: boolean;
  includeTags?: boolean;
  includeCategories?: boolean;
  includeReferences?: boolean;
  includeCoAuthors?: boolean;
  includeCustomRelations?: boolean;
  includeEmbeddingEdges?: boolean;
  /** 默认 mutual-knn；global-top 保留旧算法用于回退。 */
  embeddingStrategy?: 'mutual-knn' | 'global-top';
  /** 每篇语义邻居数，3–20，默认 10。 */
  embeddingK?: number;
  /** 去除的主成分数，0–3，默认 2。 */
  embeddingComponents?: number;
  /** 旧参数：仅 global-top 使用。 */
  embeddingEdgeLimit?: number;
  /** 旧参数：仅 global-top 使用。 */
  embeddingMinSimilarity?: number;
  search?: string | null;
  localNodeId?: string | null;
  localDepth?: number;
}

export interface KnowledgeGraphRelation {
  id: string;
  source: string;
  target: string;
  type: 'custom_relation';
  label: string;
  description?: string;
  confidence?: number;
  weight?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface KnowledgeGraphRelationUpdateRequest {
  label?: string;
  description?: string;
  weight?: number;
}

export interface KnowledgeGraphRelationCreateRequest {
  source: string;
  target: string;
  type?: 'custom_relation';
  label: string;
  description?: string;
  confidence?: number;
  weight?: number;
}

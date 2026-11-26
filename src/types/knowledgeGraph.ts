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

export type KnowledgeGraphRagStatus = 'ready' | 'stale' | 'pending' | 'failed' | 'none' | 'excluded';

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
  /** 分类显示名，与 categoryIds 对齐；用于 tooltip/inspector。 */
  categoryNames?: string[];
  /** 论文标签名；用于 tooltip/inspector 的共同标签说明。 */
  tags?: string[];
  /** 主分类 id；用于分类着色与规模聚合。 */
  primaryCategoryId?: string | null;
  /** 论文节点：0–1 阅读进度，渲染为外环。 */
  readingProgress?: number;
  /** 论文节点：RAG 索引聚合状态；非论文节点为 undefined。 */
  ragStatus?: KnowledgeGraphRagStatus;
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
  /** 语义边：中心化空间中的原始余弦，用于 tooltip/证据。 */
  similarity?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface GraphQuality {
  nodeCount: number;
  edgeCount: number;
  /** 排除标签/分类注释层后的内容节点/边数。 */
  contentNodeCount?: number;
  contentEdgeCount?: number;
  /** 语义边中心化余弦范围；仅作证据展示，不作为筛选阈值。 */
  similarityMin?: number | null;
  similarityMax?: number | null;
  degreeMin: number;
  degreeMedian: number;
  degreeMax: number;
  componentCount: number;
  isolatedCount: number;
  hubnessSkew: number;
  /** 度数统计已排除 paper_tag / note_tag / paper_category。 */
  annotationEdgesExcluded?: boolean;
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
  /** 是否用跨分量桥边连通互近邻图；默认 true。 */
  embeddingBridge?: boolean;
  /** 旧参数：仅 global-top 使用。 */
  embeddingEdgeLimit?: number;
  /** 旧参数：仅 global-top 使用。 */
  embeddingMinSimilarity?: number;
  /** 后端节点上限；UI 默认 3,000。 */
  graphNodeLimit?: number;
  /** 每个节点的边上限；UI 默认 60。 */
  graphEdgeLimitPerNode?: number;
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

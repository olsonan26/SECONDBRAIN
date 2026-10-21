export type Confidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
export type Layer = "advanced" | "foundation" | "uploaded";

export interface Brain {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  createdBy: string;
}

export interface Source {
  id: string;
  title: string;
  filename: string;
  layer: Layer;
  format: string;
  characters: number;
  pages: number;
  sha256: string;
  importedAt: string;
  provenance: string;
  originalAvailable: boolean;
  content?: string;
}
export interface Passage {
  image?: { id: string; driveId: string; sha256: string; mimeType: "image/jpeg"; filename: string; printedPage?: number; ocrVerified?: boolean };
  id: string;
  sourceId: string;
  sourceTitle: string;
  page: number | null;
  section: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  terms?: Record<string, number>;
}
export interface GraphNode {
  id: string;
  label: string;
  type: string;
  layer: Layer;
  community: string;
  sourceIds: string[];
  description: string;
  degree: number;
  knowledgeKind?: string;
  aliases?: string[];
  applicationTags?: string[];
  evidence?: KnowledgeEvidence[];
  extractionJobId?: string;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: Confidence;
  score: number;
  sourceIds: string[];
  evidence?: KnowledgeEvidence[];
  extractionJobId?: string;
}

export interface KnowledgeEvidence {
  imageId?: string;
  visualObservation?: string;
  passageId: string;
  sourceId: string;
  page: number | null;
  quote: string;
}
export interface KnowledgePassageAudit {
  passageId: string;
  sourceId: string;
  page: number | null;
  disposition: "pending" | "extracted" | "excluded-story" | "excluded-noise" | "unresolved";
  reason: string;
  nodeIds: string[];
}
export type KnowledgeStage = "queued" | "running" | "paused" | "paused-budget" | "complete" | "needs-review" | "failed";
export interface KnowledgeJobSummary {
  imagePassages?: number;
  reviewedImages?: number;
  scanPass?: number;
  completedPasses?: number[];
  openQuestions?: number;
  id: string;
  sourceIds: string[];
  author: string;
  createdAt: string;
  updatedAt: string;
  stage: KnowledgeStage;
  provider: Settings["provider"];
  model: string;
  totalPassages: number;
  processedPassages: number;
  pendingCount: number;
  reviewedPassages: number;
  extractedPassages?: number;
  excludedPassages: number;
  unresolvedPassages: number;
  nodesAdded: number;
  edgesAdded: number;
  costUsd: number;
  measuredCostUsd: number;
  estimatedCostUsd: number;
  estimatedTotalCostUsd?: number;
  budgetUsd: number;
  reservedUsd: number;
  inputTokens: number;
  outputTokens: number;
  requirementsCount: number;
  currentPhase?: "extract" | "review";
  error?: string;
  warnings: string[];
  coverage?: { question: string; status: "candidate" | "not-found" | "pending"; nodeIds: string[] }[];
}
export interface Corpus {
  version: number;
  importedAt: string;
  snapshotDate: string;
  sources: Source[];
  passages: Passage[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
  knowledgeCommits?: Record<string, {
    nodes: number; edges: number; audits?: KnowledgePassageAudit[]; warnings?: string[];
    usage?: { token: string; cost: number; measuredCost: number; inputTokens: number; outputTokens: number; measured: boolean };
  }>;
}
export interface Citation extends Passage { number: number; score: number; }
export interface Answer {
  id: string;
  question: string;
  text: string;
  mode: "extractive" | "model" | "not-found";
  citations: Citation[];
  contextTokens: number;
  corpusTokens: number;
  model: string | null;
  warnings: string[];
  createdAt: string;
}
export interface Draft {
  id: string;
  title: string;
  brief: string;
  text: string;
  status: "outline" | "draft" | "reviewed";
  citations: Citation[];
  author: string;
  updatedAt: string;
  revision: number;
  mode: "extractive" | "model";
  evidenceMap?: { paragraphIndex: number; citations: number[] }[];
}
export interface Run {
  id: string;
  kind: string;
  title: string;
  state: "complete" | "needs-model" | "needs-sources" | "failed";
  steps: { label: string; state: "complete" | "skipped" | "failed"; detail: string }[];
  result: string;
  sourceIds: string[];
  author: string;
  createdAt: string;
}
export interface Settings {
  provider: "deepseek" | "openrouter";
  model: string;
  apiKey?: string;
  writingInstructions: string;
}
export interface Workspace {
  recovery?: import("./recovery-state-core").PublicRecoveryState | null;
  graphOverviewOnly?: boolean;
  brain: Brain;
  brains: Brain[];
  user: { name: string; role: "owner" | "member" };
  sources: Source[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { sources: number; passages: number; nodes: number; teachings?: number; edges: number; characters: number; pages: number };
  settings: { provider: Settings["provider"]; model: string; connected: boolean; writingInstructions: string };
  drafts: Draft[];
  runs: Run[];
  warnings: string[];
  snapshotDate: string;
  importedAt: string;
  persistence: "cloud" | "local";
}

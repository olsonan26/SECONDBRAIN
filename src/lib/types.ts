export type Confidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
export type Layer = "advanced" | "foundation" | "uploaded";

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
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: Confidence;
  score: number;
  sourceIds: string[];
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
  user: { name: string; role: "owner" | "member" };
  sources: Source[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { sources: number; passages: number; nodes: number; edges: number; characters: number; pages: number };
  settings: { provider: Settings["provider"]; model: string; connected: boolean; writingInstructions: string };
  drafts: Draft[];
  runs: Run[];
  warnings: string[];
  snapshotDate: string;
  importedAt: string;
  persistence: "cloud" | "local";
}

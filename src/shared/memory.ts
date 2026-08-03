export type MemoryKind =
  | "fact"
  | "preference"
  | "project"
  | "inference"
  | "unclassified";

export type MemoryScope =
  | { type: "global" }
  | { type: "project"; projectId: string };

export type MemoryEvidenceSource =
  | "explicit"
  | "conversation"
  | "legacy"
  | "user-edit";

export interface MemoryEvidence {
  source: MemoryEvidenceSource;
  excerpt: string;
  createdAt: string;
  requestId?: string;
  conversationId?: string;
}

export interface MemoryEntry {
  id: string;
  key: string;
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
  status: "active" | "superseded";
  confidence: number;
  reinforcementCount: number;
  evidence: MemoryEvidence[];
  createdAt: string;
  updatedAt: string;
  supersededBy?: string;
}

export interface MemorySnapshot {
  version: 1;
  enabled: boolean;
  entries: MemoryEntry[];
  profileSummary: string;
  turnsSinceConsolidation: number;
  legacyMigrated: boolean;
  updatedAt: string;
  lastLearnedAt?: string;
  lastError?: string;
}

export interface MemoryCandidate {
  key: string;
  kind: Exclude<MemoryKind, "unclassified">;
  scope: MemoryScope;
  content: string;
  confidence: number;
  evidence: string;
}

export interface MemoryTurn {
  requestId: string;
  conversationId: string;
  projectId: string;
  userMessage: string;
  assistantMessage: string;
}

export interface RememberMemoryInput {
  key?: string;
  content: string;
  kind?: MemoryKind;
  scope: MemoryScope;
  source: MemoryEvidenceSource;
  requestId?: string;
  conversationId?: string;
}

export interface UpdateMemoryInput {
  content?: string;
  kind?: MemoryKind;
  scope?: MemoryScope;
}

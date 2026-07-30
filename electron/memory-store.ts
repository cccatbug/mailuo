import { randomUUID } from "node:crypto";

export type MemoryKind = "fact" | "preference" | "project" | "inference";
export type MemoryStatus = "active" | "superseded";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  key: string;
  value: string;
  projectId?: string;
  evidence: string;
  confidence: number;
  status: MemoryStatus;
  createdAt: number;
  updatedAt: number;
}

type MemoryInput = Omit<MemoryEntry, "id" | "status" | "createdAt" | "updatedAt">;

export class LayeredMemoryStore {
  enabled = true;
  private entries = new Map<string, MemoryEntry>();

  constructor(entries: MemoryEntry[] = []) {
    for (const entry of entries) this.entries.set(entry.id, entry);
  }

  upsert(input: MemoryInput): MemoryEntry {
    if (!this.enabled) throw new Error("长期记忆已禁用");
    const existing = this.list().find(
      (entry) =>
        entry.kind === input.kind &&
        entry.key === input.key &&
        entry.projectId === input.projectId
    );
    const now = Date.now();
    if (existing?.value === input.value) {
      return this.update(existing.id, {
        evidence: input.evidence,
        confidence: Math.max(existing.confidence, input.confidence),
      });
    }
    if (existing) this.update(existing.id, { status: "superseded" });
    const entry: MemoryEntry = {
      ...input,
      id: randomUUID(),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  update(id: string, patch: Partial<Omit<MemoryEntry, "id" | "createdAt">>) {
    const current = this.entries.get(id);
    if (!current) throw new Error(`记忆 ${id} 不存在`);
    const next = { ...current, ...patch, id, createdAt: current.createdAt, updatedAt: Date.now() };
    this.entries.set(id, next);
    return next;
  }

  remove(id: string) {
    return this.entries.delete(id);
  }

  list(options: { includeSuperseded?: boolean } = {}) {
    return [...this.entries.values()].filter(
      (entry) => options.includeSuperseded || entry.status === "active"
    );
  }

  rebuild(entries: MemoryEntry[]) {
    this.entries = new Map(entries.map((entry) => [entry.id, entry]));
  }

  context(projectId?: string): string {
    if (!this.enabled) return "";
    const labels: Record<MemoryKind, string> = {
      fact: "明确事实",
      preference: "稳定偏好",
      project: "项目记忆",
      inference: "推断画像（非事实）",
    };
    return (["fact", "preference", "project", "inference"] as MemoryKind[])
      .map((kind) => {
        const entries = this.list().filter(
          (entry) =>
            entry.kind === kind &&
            (kind !== "project" || entry.projectId === projectId)
        );
        if (!entries.length) return "";
        return `## ${labels[kind]}\n${entries
          .map((entry) => `- ${entry.key}: ${entry.value}（依据：${entry.evidence}）`)
          .join("\n")}`;
      })
      .filter(Boolean)
      .join("\n\n");
  }
}

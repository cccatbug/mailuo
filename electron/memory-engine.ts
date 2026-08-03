import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  MemoryCandidate,
  MemoryEntry,
  MemoryEvidence,
  MemoryKind,
  MemoryScope,
  MemorySnapshot,
  MemoryTurn,
  RememberMemoryInput,
  UpdateMemoryInput,
} from "../src/shared/memory";

export interface MemoryExtractor {
  extract(turn: MemoryTurn): Promise<{ candidates: MemoryCandidate[] }>;
  classify?(entries: MemoryEntry[]): Promise<{ candidates: MemoryCandidate[] }>;
}

interface MemoryEngineOptions {
  filePath: string;
  legacyPath: string;
  extractor?: MemoryExtractor;
  now?: () => string;
  createId?: () => string;
}

const EMPTY_DOCUMENT = (): MemorySnapshot => ({
  version: 1,
  enabled: true,
  entries: [],
  profileSummary: "",
  turnsSinceConsolidation: 0,
  legacyMigrated: false,
  updatedAt: new Date(0).toISOString(),
});

const normalizedKey = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, " ").slice(0, 160);

const normalizedContent = (value: string) =>
  value.trim().replace(/\s+/g, " ");

export function extractExplicitMemoryCue(message: string): string | null {
  const value = message.trim();
  if (/(?:不要|别|不用|无需).{0,4}(?:记住|记一下)/.test(value)) return null;
  const match = /(?:^|[。！？!?\n])\s*(?:请|帮我)?(?:记住|记一下)[：:,，\s]*(.+)$/s.exec(value);
  const content = match?.[1]?.trim();
  return content ? content.slice(0, 600) : null;
}

const sameScope = (left: MemoryScope, right: MemoryScope) =>
  left.type === right.type &&
  (left.type === "global" ||
    (right.type === "project" && left.projectId === right.projectId));

function profileSummary(entries: MemoryEntry[]): string {
  const active = entries
    .filter(
      (entry) =>
        entry.status === "active" &&
        entry.scope.type === "global" &&
        (entry.kind !== "inference" || entry.confidence >= 0.7)
    )
    .sort((a, b) => b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt));
  const groups: [MemoryKind, string][] = [
    ["fact", "用户事实"],
    ["preference", "稳定偏好"],
    ["inference", "推断画像"],
  ];
  return groups
    .map(([kind, label]) => {
      const values = active.filter((entry) => entry.kind === kind).slice(0, 6);
      return values.length ? `${label}：${values.map((entry) => entry.content).join("；")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function validDocument(value: unknown): value is MemorySnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MemorySnapshot>;
  return candidate.version === 1 && typeof candidate.enabled === "boolean" && Array.isArray(candidate.entries);
}

export class MemoryEngine {
  private document: MemorySnapshot | null = null;
  private operation = Promise.resolve<unknown>(undefined);
  private learning = Promise.resolve<void>(undefined);
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(private readonly options: MemoryEngineOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  snapshot(): Promise<MemorySnapshot> {
    return this.run(async () => structuredClone(await this.load()));
  }

  remember(input: RememberMemoryInput): Promise<MemoryEntry> {
    return this.run(async () => {
      const document = await this.load();
      const content = input.content.trim();
      if (!content) throw new Error("记忆内容不能为空");
      const timestamp = this.now();
      const evidence: MemoryEvidence = {
        source: input.source,
        excerpt: content.slice(0, 240),
        createdAt: timestamp,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      };
      const entry = this.mergeCandidate(document, {
        key: input.key ?? content,
        kind: input.kind ?? "unclassified",
        content,
        scope: input.scope,
        confidence: input.source === "explicit" || input.source === "user-edit" ? 1 : 0.8,
        evidence,
      });
      this.refreshProfile(document);
      await this.persist(document);
      return structuredClone(entry);
    });
  }

  learnTurn(turn: MemoryTurn): Promise<void> {
    const learning = this.learning.then(async () => {
      const enabled = await this.run(async () => (await this.load()).enabled);
      if (!enabled || !this.options.extractor) return;
      try {
        const result = await this.options.extractor.extract(turn);
        await this.run(async () => {
          const document = await this.load();
          if (!document.enabled) return;
          for (const candidate of result.candidates.slice(0, 12)) {
            const content = candidate.content.trim();
            const key = candidate.key.trim();
            if (!content || !key) continue;
            const scope =
              candidate.kind === "project"
                ? { type: "project" as const, projectId: turn.projectId }
                : candidate.scope.type === "project"
                  ? { type: "project" as const, projectId: turn.projectId }
                  : { type: "global" as const };
            this.mergeCandidate(document, {
              ...candidate,
              scope,
              confidence: Math.max(0, Math.min(1, candidate.confidence)),
              evidence: {
                source: "conversation",
                excerpt:
                  candidate.evidence.trim().slice(0, 240) ||
                  turn.userMessage.slice(0, 240),
                createdAt: this.now(),
                requestId: turn.requestId,
                conversationId: turn.conversationId,
              },
            });
          }
          document.turnsSinceConsolidation += 1;
          document.lastLearnedAt = this.now();
          delete document.lastError;
          if (document.turnsSinceConsolidation >= 8) {
            this.consolidateDocument(document);
          }
          this.refreshProfile(document);
          await this.persist(document);
        });
      } catch (error) {
        await this.run(async () => {
          const document = await this.load();
          document.lastError = error instanceof Error ? error.message : String(error);
          await this.persist(document);
        });
      }
    });
    this.learning = learning.then(() => undefined, () => undefined);
    return learning;
  }

  setEnabled(enabled: boolean): Promise<MemorySnapshot> {
    return this.run(async () => {
      const document = await this.load();
      document.enabled = enabled;
      await this.persist(document);
      return structuredClone(document);
    });
  }

  update(id: string, patch: UpdateMemoryInput): Promise<MemoryEntry> {
    return this.run(async () => {
      const document = await this.load();
      const entry = document.entries.find((candidate) => candidate.id === id);
      if (!entry) throw new Error("记忆不存在");
      if (patch.content !== undefined) {
        const content = patch.content.trim();
        if (!content) throw new Error("记忆内容不能为空");
        entry.content = content;
        entry.key = normalizedKey(content);
      }
      if (patch.kind) entry.kind = patch.kind;
      if (patch.scope) entry.scope = patch.scope;
      entry.status = "active";
      delete entry.supersededBy;
      entry.confidence = 1;
      entry.reinforcementCount += 1;
      entry.updatedAt = this.now();
      entry.evidence.push({
        source: "user-edit",
        excerpt: entry.content.slice(0, 240),
        createdAt: entry.updatedAt,
      });
      this.refreshProfile(document);
      await this.persist(document);
      return structuredClone(entry);
    });
  }

  delete(id: string): Promise<boolean> {
    return this.run(async () => {
      const document = await this.load();
      const before = document.entries.length;
      document.entries = document.entries.filter((entry) => entry.id !== id);
      if (document.entries.length === before) return false;
      this.refreshProfile(document);
      await this.persist(document);
      return true;
    });
  }

  rebuild(): Promise<MemorySnapshot> {
    return this.rebuildWithClassification();
  }

  private async rebuildWithClassification(): Promise<MemorySnapshot> {
    const unclassified = await this.run(async () =>
      (await this.load()).entries.filter(
        (entry) => entry.status === "active" && entry.kind === "unclassified"
      )
    );
    let classified: MemoryCandidate[] = [];
    if (unclassified.length > 0 && this.options.extractor?.classify) {
      try {
        classified = (await this.options.extractor.classify(unclassified)).candidates;
      } catch (error) {
        await this.run(async () => {
          const document = await this.load();
          document.lastError = error instanceof Error ? error.message : String(error);
          await this.persist(document);
        });
      }
    }
    return this.run(async () => {
      const document = await this.load();
      for (const candidate of classified) {
        this.mergeCandidate(document, {
          ...candidate,
          evidence: {
            source: "legacy",
            excerpt: candidate.evidence.slice(0, 240),
            createdAt: this.now(),
          },
        });
      }
      this.consolidateDocument(document);
      if (unclassified.length === 0 || classified.length > 0) {
        delete document.lastError;
      }
      await this.persist(document);
      return structuredClone(document);
    });
  }

  context(projectId: string, maxChars: number): Promise<string> {
    return this.run(async () => {
      const document = await this.load();
      if (!document.enabled || maxChars <= 0) return "";
      const entries = document.entries
        .filter(
          (entry) =>
            entry.status === "active" &&
            (entry.scope.type === "global" || entry.scope.projectId === projectId) &&
            (entry.kind !== "inference" || entry.confidence >= 0.7)
        )
        .sort(
          (a, b) =>
            Number(b.scope.type === "project") - Number(a.scope.type === "project") ||
            b.confidence - a.confidence ||
            b.reinforcementCount - a.reinforcementCount ||
            b.updatedAt.localeCompare(a.updatedAt)
        );
      const lines = [
        document.profileSummary ? `【用户画像摘要】\n${document.profileSummary}` : "",
        ...entries.map((entry) => {
          const label = {
            fact: "事实",
            preference: "偏好",
            project: "项目记忆",
            inference: "推断（非事实）",
            unclassified: "旧记忆（待整理）",
          }[entry.kind];
          return `- [${label}] ${entry.content}`;
        }),
      ].filter(Boolean);
      const result = lines.join("\n");
      return result.length <= maxChars ? result : `${result.slice(0, Math.max(0, maxChars - 1))}…`;
    });
  }

  private run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operation.then(action, action);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async load(): Promise<MemorySnapshot> {
    if (this.document) return this.document;
    let document = EMPTY_DOCUMENT();
    try {
      const parsed = JSON.parse(await fs.readFile(this.options.filePath, "utf8"));
      if (validDocument(parsed)) document = parsed;
    } catch {
      // First run or corrupt legacy data: start from a safe document.
    }
    this.document = document;
    if (!document.legacyMigrated) {
      await this.migrateLegacy(document);
    }
    return document;
  }

  private async migrateLegacy(document: MemorySnapshot): Promise<void> {
    try {
      const legacy = await fs.readFile(this.options.legacyPath, "utf8");
      for (const raw of legacy.split(/\r?\n/)) {
        const match = /^\s*-\s+(?:\(\d{4}-\d{2}-\d{2}\)\s*)?(.+?)\s*$/.exec(raw);
        const content = match?.[1]?.trim();
        if (!content) continue;
        this.mergeCandidate(document, {
          key: content,
          kind: "unclassified",
          content,
          scope: { type: "global" },
          confidence: 1,
          evidence: {
            source: "legacy",
            excerpt: content.slice(0, 240),
            createdAt: this.now(),
          },
        });
      }
    } catch {
      // Missing legacy file is the normal first-run case.
    }
    document.legacyMigrated = true;
    this.refreshProfile(document);
    await this.persist(document);
  }

  private mergeCandidate(
    document: MemorySnapshot,
    candidate: {
      key: string;
      kind: MemoryKind;
      scope: MemoryScope;
      content: string;
      confidence: number;
      evidence: MemoryEvidence;
    }
  ): MemoryEntry {
    const key = normalizedKey(candidate.key);
    const content = candidate.content.trim();
    const active = document.entries.find(
      (entry) => entry.status === "active" && entry.key === key && sameScope(entry.scope, candidate.scope)
    );
    if (active && candidate.kind === "inference" && active.kind !== "inference") {
      return active;
    }
    if (active && normalizedContent(active.content) === normalizedContent(content)) {
      if (active.kind === "unclassified" && candidate.kind !== "unclassified") {
        active.kind = candidate.kind;
        active.scope = candidate.scope;
      }
      active.confidence = Math.min(1, Math.max(active.confidence, candidate.confidence) + 0.08);
      active.reinforcementCount += 1;
      active.updatedAt = this.now();
      active.evidence = [...active.evidence, candidate.evidence].slice(-8);
      return active;
    }
    const timestamp = this.now();
    const entry: MemoryEntry = {
      id: this.createId(),
      key,
      kind: candidate.kind,
      scope: candidate.scope,
      content,
      status: "active",
      confidence: candidate.confidence,
      reinforcementCount: 1,
      evidence: [candidate.evidence],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (active) {
      active.status = "superseded";
      active.supersededBy = entry.id;
      active.updatedAt = timestamp;
    }
    document.entries.push(entry);
    return entry;
  }

  private consolidateDocument(document: MemorySnapshot): void {
    const seen = new Map<string, MemoryEntry>();
    for (const entry of document.entries.filter((candidate) => candidate.status === "active")) {
      const signature = `${entry.kind}:${entry.scope.type === "global" ? "global" : entry.scope.projectId}:${normalizedContent(entry.content)}`;
      const existing = seen.get(signature);
      if (!existing) {
        seen.set(signature, entry);
        continue;
      }
      existing.reinforcementCount += entry.reinforcementCount;
      existing.confidence = Math.min(1, Math.max(existing.confidence, entry.confidence) + 0.08);
      existing.evidence = [...existing.evidence, ...entry.evidence].slice(-8);
      existing.updatedAt = this.now();
      entry.status = "superseded";
      entry.supersededBy = existing.id;
      entry.updatedAt = this.now();
    }
    document.turnsSinceConsolidation = 0;
    this.refreshProfile(document);
  }

  private refreshProfile(document: MemorySnapshot): void {
    document.profileSummary = profileSummary(document.entries);
    document.updatedAt = this.now();
  }

  private async persist(document: MemorySnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.options.filePath), { recursive: true });
    const temp = `${this.options.filePath}.tmp`;
    await fs.writeFile(temp, JSON.stringify(document, null, 2), "utf8");
    await fs.rename(temp, this.options.filePath);
  }
}

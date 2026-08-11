/**
 * 项目数据库引擎（主进程单例）。
 *
 * 每个项目一个 SQLite 文件：~/.mailuo/workspace/<projectId>/mailuo.db。
 * 使用 Node 内置 node:sqlite（DatabaseSync）——Electron 43 自带 Node 24 直接可用，
 * 无 native 依赖、无打包 rebuild 负担，且引擎在主进程运行，
 * 常驻小枢会话与定时任务 headless 执行都能使用（不依赖渲染进程窗口）。
 *
 * 应用数据镜像：app_* 系统表由 syncAppData() 从应用各数据源重建，只读；
 * `app_` / `_mailuo` 前缀被系统独占，用户建表与任何写路径都不允许触碰。
 */
import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import path from "node:path";
import { workspaceDir } from "./pi";
import {
  dbFirstKeyword,
  isDbReadOnlyStatement,
  type AppDataSnapshot,
  type DbAlterTableInput,
  type DbColumnSpec,
  type DbCondition,
  type DbCreateTableInput,
  type DbDescribeResult,
  type DbOverview,
  type DbQueryResult,
  type DbTableInfo,
} from "../src/shared/project-db";

export const DB_FILE_NAME = "mailuo.db";
/** 应用数据镜像的自动同步间隔；超过则在下一次数据库访问时重建 */
export const APP_SYNC_TTL_MS = 15_000;
export const DEFAULT_QUERY_LIMIT = 200;
export const MAX_QUERY_LIMIT = 2000;
/** 单条 SQL 输出给模型 / UI 的字符上限 */
export const OUTPUT_CHAR_LIMIT = 40_000;

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 系统表前缀：镜像表与元数据表，用户不可建、不可写、不可删 */
const SYSTEM_PREFIXES = ["app_", "_mailuo"];

const SYSTEM_TABLE_DESCRIPTIONS: Record<string, string> = {
  app_projects: "脉络全部项目（应用数据镜像，只读）",
  app_tasks: "脉络全部任务，含状态、标签、依赖、日期安排（应用数据镜像，只读）",
  app_scheduled_jobs: "定时任务配置（应用数据镜像，只读）",
  app_scheduled_runs: "定时任务执行历史（应用数据镜像，只读）",
  app_assets: "项目资产文件清单（应用数据镜像，只读）",
  app_memories: "小枢长期记忆（应用数据镜像，只读）",
};

export interface AppDataSource {
  /** 收集当前应用数据快照；projectId 用于限定资产等按项目存放的数据 */
  load(projectId: string): Promise<AppDataSnapshot>;
}

/* ---------- 值转换 ---------- */

type SqlValue = string | number | null | Uint8Array;

function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

/** SQLite 返回值 → 可 JSON 序列化形式（bigint / blob 归一） */
function fromSqlValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Uint8Array) {
    return `base64:${Buffer.from(value).toString("base64")}`;
  }
  return value;
}

function normalizeRows(rawRows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rawRows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) out[key] = fromSqlValue(value);
    return out;
  });
}

function assertIdentifier(value: string, what: string): string {
  const trimmed = value.trim();
  if (!IDENTIFIER_RE.test(trimmed)) {
    throw new Error(`${what}只能包含字母、数字、下划线，且不能以数字开头（收到「${value}」）`);
  }
  return trimmed;
}

function isSystemTableName(name: string): boolean {
  return SYSTEM_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function assertUserTable(name: string): string {
  const trimmed = assertIdentifier(name, "表名");
  if (isSystemTableName(trimmed)) {
    throw new Error(
      `表「${trimmed}」是系统表（app_* / _mailuo* 前缀由系统独占），只读，不可创建、修改或删除`
    );
  }
  if (trimmed.toLowerCase().startsWith("sqlite_")) {
    throw new Error("表名不能使用 sqlite_ 前缀");
  }
  return trimmed;
}

function assertKnownTable(db: DatabaseSync, table: string): void {
  const found = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?")
    .get(table);
  if (!found) throw new Error(`表「${table}」不存在；先用 db_overview 查看现有表`);
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info('${table}')`).all() as {
    name: string;
  }[];
  return rows.map((row) => row.name);
}

/** 写语句里若出现系统表名则拒绝（保守拦截，宁可误报） */
function findSystemTableReference(sql: string): string | null {
  const identifiers = sql.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const ident of identifiers) {
    if (isSystemTableName(ident) && !ident.startsWith("_mailuo_meta")) return ident;
  }
  return null;
}

const WRITE_KEYWORDS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE",
  "DROP",
  "ALTER",
  "CREATE",
  "VACUUM",
  "REINDEX",
]);

function columnDefinition(column: DbColumnSpec): string {
  const name = assertIdentifier(column.name, "列名");
  const type = column.type.toUpperCase();
  const parts = [`"${name}" ${type}`];
  if (column.primaryKey) parts.push("PRIMARY KEY");
  if (column.required && !column.primaryKey) parts.push("NOT NULL");
  if (column.unique && !column.primaryKey) parts.push("UNIQUE");
  if (column.defaultValue !== undefined && column.defaultValue !== null) {
    parts.push(
      typeof column.defaultValue === "number"
        ? `DEFAULT ${column.defaultValue}`
        : `DEFAULT '${String(column.defaultValue).replace(/'/g, "''")}'`
    );
  }
  return parts.join(" ");
}

function buildWhere(
  db: DatabaseSync,
  table: string,
  conditions: DbCondition[]
): { sql: string; params: SqlValue[] } {
  if (!conditions.length) return { sql: "", params: [] };
  const known = new Set(tableColumns(db, table));
  const fragments: string[] = [];
  const params: SqlValue[] = [];
  for (const condition of conditions) {
    const column = assertIdentifier(condition.column, "条件列名");
    if (!known.has(column)) {
      throw new Error(`表「${table}」没有列「${column}」；现有列：${[...known].join(", ")}`);
    }
    const col = `"${column}"`;
    switch (condition.op) {
      case "eq":
        fragments.push(`${col} = ?`);
        params.push(toSqlValue(condition.value));
        break;
      case "ne":
        fragments.push(`${col} <> ?`);
        params.push(toSqlValue(condition.value));
        break;
      case "gt":
        fragments.push(`${col} > ?`);
        params.push(toSqlValue(condition.value));
        break;
      case "ge":
        fragments.push(`${col} >= ?`);
        params.push(toSqlValue(condition.value));
        break;
      case "lt":
        fragments.push(`${col} < ?`);
        params.push(toSqlValue(condition.value));
        break;
      case "le":
        fragments.push(`${col} <= ?`);
        params.push(toSqlValue(condition.value));
        break;
      case "like":
        fragments.push(`${col} LIKE ?`);
        params.push(String(condition.value ?? ""));
        break;
      case "contains":
        fragments.push(`${col} LIKE ?`);
        params.push(`%${String(condition.value ?? "")}%`);
        break;
      case "in":
      case "not_in": {
        const values = Array.isArray(condition.value) ? condition.value : [condition.value];
        if (values.length === 0) throw new Error(`${condition.op} 条件的 value 不能为空数组`);
        fragments.push(`${col} ${condition.op === "in" ? "IN" : "NOT IN"} (${values.map(() => "?").join(", ")})`);
        for (const value of values) params.push(toSqlValue(value));
        break;
      }
      case "is_null":
        fragments.push(`${col} IS NULL`);
        break;
      case "not_null":
        fragments.push(`${col} IS NOT NULL`);
        break;
      default:
        throw new Error(`不支持的条件操作：${(condition as DbCondition).op}`);
    }
  }
  return { sql: ` WHERE ${fragments.join(" AND ")}`, params };
}

/* ---------- 应用数据镜像定义 ---------- */

interface MirrorColumn {
  name: string;
  type: "TEXT" | "INTEGER" | "REAL";
}

interface MirrorDef {
  table: string;
  columns: MirrorColumn[];
  map: (snapshot: AppDataSnapshot) => Record<string, unknown>[];
}

function jsonOf(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

const MIRROR_DEFS: MirrorDef[] = [
  {
    table: "app_projects",
    columns: [
      { name: "id", type: "TEXT" },
      { name: "name", type: "TEXT" },
      { name: "color", type: "TEXT" },
      { name: "pinned", type: "INTEGER" },
      { name: "archived", type: "INTEGER" },
      { name: "created_at", type: "INTEGER" },
    ],
    map: (s) =>
      s.projects.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color ?? null,
        pinned: p.pinned ? 1 : 0,
        archived: p.archived ? 1 : 0,
        created_at: p.createdAt ?? null,
      })),
  },
  {
    table: "app_tasks",
    columns: [
      { name: "id", type: "TEXT" },
      { name: "project_id", type: "TEXT" },
      { name: "title", type: "TEXT" },
      { name: "status", type: "TEXT" },
      { name: "priority", type: "TEXT" },
      { name: "tags", type: "TEXT" },
      { name: "notes", type: "TEXT" },
      { name: "due_date", type: "TEXT" },
      { name: "schedule", type: "TEXT" },
      { name: "tracking", type: "TEXT" },
      { name: "depends_on", type: "TEXT" },
      { name: "importance", type: "REAL" },
      { name: "urgency", type: "REAL" },
      { name: "created_at", type: "INTEGER" },
      { name: "completed_at", type: "INTEGER" },
    ],
    map: (s) =>
      s.tasks.map((t) => ({
        id: t.id,
        project_id: t.projectId,
        title: t.title,
        status: t.status,
        priority: t.priority,
        tags: jsonOf(t.tags),
        notes: t.notes ?? "",
        due_date: t.dueDate ?? null,
        schedule: jsonOf(t.schedule),
        tracking: jsonOf(t.tracking),
        depends_on: jsonOf(t.deps),
        importance: t.importance ?? null,
        urgency: t.urgency ?? null,
        created_at: t.createdAt ?? null,
        completed_at: t.completedAt ?? null,
      })),
  },
  {
    table: "app_scheduled_jobs",
    columns: [
      { name: "id", type: "TEXT" },
      { name: "project_id", type: "TEXT" },
      { name: "name", type: "TEXT" },
      { name: "prompt", type: "TEXT" },
      { name: "schedule", type: "TEXT" },
      { name: "enabled", type: "INTEGER" },
      { name: "created_at", type: "INTEGER" },
      { name: "updated_at", type: "INTEGER" },
      { name: "last_run_at", type: "INTEGER" },
      { name: "last_status", type: "TEXT" },
      { name: "next_run_at", type: "INTEGER" },
    ],
    map: (s) =>
      s.scheduledJobs.map((j) => ({
        id: j.id,
        project_id: j.projectId,
        name: j.name,
        prompt: j.prompt,
        schedule: jsonOf(j.schedule),
        enabled: j.enabled ? 1 : 0,
        created_at: j.createdAt ?? null,
        updated_at: j.updatedAt ?? null,
        last_run_at: j.lastRunAt ?? null,
        last_status: j.lastStatus ?? null,
        next_run_at: j.nextRunAt ?? null,
      })),
  },
  {
    table: "app_scheduled_runs",
    columns: [
      { name: "id", type: "TEXT" },
      { name: "job_id", type: "TEXT" },
      { name: "project_id", type: "TEXT" },
      { name: "job_name", type: "TEXT" },
      { name: "trigger", type: "TEXT" },
      { name: "status", type: "TEXT" },
      { name: "started_at", type: "INTEGER" },
      { name: "finished_at", type: "INTEGER" },
      { name: "error", type: "TEXT" },
      { name: "result_markdown", type: "TEXT" },
    ],
    map: (s) =>
      s.scheduledRuns.map((r) => ({
        id: r.id,
        job_id: r.jobId,
        project_id: r.projectId,
        job_name: r.jobName,
        trigger: r.trigger,
        status: r.status,
        started_at: r.startedAt ?? null,
        finished_at: r.finishedAt ?? null,
        error: r.error ?? null,
        result_markdown: r.resultMarkdown ?? null,
      })),
  },
  {
    table: "app_assets",
    columns: [
      { name: "id", type: "TEXT" },
      { name: "project_id", type: "TEXT" },
      { name: "name", type: "TEXT" },
      { name: "relative_path", type: "TEXT" },
      { name: "mime_type", type: "TEXT" },
      { name: "size", type: "INTEGER" },
      { name: "tags", type: "TEXT" },
      { name: "favorite", type: "INTEGER" },
      { name: "trashed", type: "INTEGER" },
      { name: "created_at", type: "INTEGER" },
    ],
    map: (s) =>
      s.assets.map((a) => ({
        id: a.id,
        project_id: a.projectId,
        name: a.name,
        relative_path: a.relativePath,
        mime_type: a.mimeType,
        size: a.size ?? null,
        tags: jsonOf(a.tags),
        favorite: a.favorite ? 1 : 0,
        trashed: a.trashed ? 1 : 0,
        created_at: a.createdAt ?? null,
      })),
  },
  {
    table: "app_memories",
    columns: [
      { name: "id", type: "TEXT" },
      { name: "key", type: "TEXT" },
      { name: "kind", type: "TEXT" },
      { name: "scope", type: "TEXT" },
      { name: "project_id", type: "TEXT" },
      { name: "content", type: "TEXT" },
      { name: "status", type: "TEXT" },
      { name: "confidence", type: "REAL" },
      { name: "created_at", type: "TEXT" },
      { name: "updated_at", type: "TEXT" },
    ],
    map: (s) =>
      s.memories.map((m) => {
        const scope = m.scope as { type?: string; projectId?: string } | undefined;
        return {
          id: m.id,
          key: m.key,
          kind: m.kind,
          scope: scope?.type ?? "global",
          project_id: scope?.projectId ?? null,
          content: m.content,
          status: m.status,
          confidence: m.confidence ?? null,
          created_at: m.createdAt ?? null,
          updated_at: m.updatedAt ?? null,
        };
      }),
  },
];

/* ---------- 引擎 ---------- */

export class ProjectDbManager {
  private readonly connections = new Map<string, DatabaseSync>();
  private appDataSource: AppDataSource | null = null;
  /** 全局串行队列：DB 操作是同步的，只有应用数据同步含 await，串行避免交叉重建 */
  private chain = Promise.resolve<unknown>(undefined);

  setAppDataSource(source: AppDataSource): void {
    this.appDataSource = source;
  }

  dbPath(projectId: string): string {
    return path.join(workspaceDir(projectId), DB_FILE_NAME);
  }

  /** 删除项目的数据库文件（含 WAL 附属文件） */
  async deleteDatabase(projectId: string): Promise<void> {
    await this.run(() => {
      this.closeConnection(projectId);
      const base = this.dbPath(projectId);
      return Promise.all(
        [base, `${base}-wal`, `${base}-shm`].map((file) =>
          fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          })
        )
      );
    });
  }

  closeAll(): void {
    for (const projectId of [...this.connections.keys()]) {
      this.closeConnection(projectId);
    }
  }

  overview(projectId: string): Promise<DbOverview> {
    return this.run(async () => {
      await this.maybeSyncAppData(projectId, false);
      const db = await this.open(projectId);
      const masters = db
        .prepare(
          "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as { name: string; type: string }[];
      const tables: DbTableInfo[] = masters
        .filter((m) => !m.name.startsWith("_mailuo"))
        .map((m) => {
          const rowCount = (
            db.prepare(`SELECT COUNT(*) AS c FROM "${m.name}"`).get() as { c: number | bigint }
          ).c;
          return {
            name: m.name,
            kind: m.type === "view" ? ("view" as const) : ("table" as const),
            rowCount: Number(rowCount),
            system: isSystemTableName(m.name),
            ...(SYSTEM_TABLE_DESCRIPTIONS[m.name]
              ? { description: SYSTEM_TABLE_DESCRIPTIONS[m.name] }
              : {}),
          };
        });
      return {
        projectId,
        path: this.dbPath(projectId),
        tables,
        lastAppSyncAt: this.readMeta(db, "last_app_sync"),
      };
    });
  }

  describeTable(projectId: string, table: string): Promise<DbDescribeResult> {
    return this.run(async () => {
      const name = assertIdentifier(table, "表名");
      await this.maybeSyncAppData(projectId, false);
      const db = await this.open(projectId);
      assertKnownTable(db, name);
      const columns = (db.prepare(`PRAGMA table_info('${name}')`).all() as {
        name: string;
        type: string;
        notnull: number;
        pk: number;
        dflt_value: string | null;
      }[]).map((c) => ({
        name: c.name,
        type: c.type || "TEXT",
        notNull: c.notnull === 1,
        primaryKey: c.pk > 0,
        defaultValue: c.dflt_value,
      }));
      const indexes = (db.prepare(`PRAGMA index_list('${name}')`).all() as {
        name: string;
        unique: number;
      }[])
        .filter((index) => !index.name.startsWith("sqlite_autoindex"))
        .map((index) => ({
          name: index.name,
          unique: index.unique === 1,
          columns: (db.prepare(`PRAGMA index_info('${index.name}')`).all() as { name: string }[]).map(
            (c) => c.name
          ),
        }));
      const sampleRows = normalizeRows(
        db.prepare(`SELECT * FROM "${name}" LIMIT 5`).all() as Record<string, unknown>[]
      );
      const rowCount = Number(
        (db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number | bigint }).c
      );
      const createSql = (
        db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as
          | { sql: string | null }
          | undefined
      )?.sql ?? null;
      return {
        table: name,
        system: isSystemTableName(name),
        rowCount,
        columns,
        indexes,
        sampleRows,
        createSql,
      };
    });
  }

  /** 只读查询：仅允许 SELECT/WITH/PRAGMA/EXPLAIN */
  query(
    projectId: string,
    sql: string,
    params: unknown[] = [],
    limit: number = DEFAULT_QUERY_LIMIT
  ): Promise<DbQueryResult> {
    return this.run(async () => {
      const statement = sql.trim();
      if (!statement) throw new Error("SQL 不能为空");
      if (!isDbReadOnlyStatement(statement)) {
        throw new Error(
          `db_query 只接受只读语句（SELECT / WITH / PRAGMA / EXPLAIN）；写操作请用 db_execute 或结构化工具`
        );
      }
      if (dbFirstKeyword(statement) === "PRAGMA" && /PRAGMA\s+\w+\s*=/i.test(statement)) {
        throw new Error("带赋值的 PRAGMA 是写操作，不允许执行");
      }
      await this.maybeSyncAppData(projectId, false);
      const db = await this.open(projectId);
      const started = Date.now();
      const raw = db.prepare(statement).all(...params.map(toSqlValue)) as Record<string, unknown>[];
      const capped = Math.min(Math.max(1, Math.floor(limit)), MAX_QUERY_LIMIT);
      const rows = normalizeRows(raw.slice(0, capped));
      return {
        kind: "query",
        columns: rows[0] ? Object.keys(rows[0]) : [],
        rows,
        rowCount: rows.length,
        truncated: raw.length > capped,
        elapsedMs: Date.now() - started,
      };
    });
  }

  /** 执行单条写语句（DML / DDL / 事务控制外的任意语句） */
  execute(projectId: string, sql: string, params: unknown[] = []): Promise<DbQueryResult> {
    return this.run(async () => {
      const statement = sql.trim();
      if (!statement) throw new Error("SQL 不能为空");
      const keyword = dbFirstKeyword(statement);
      if (isDbReadOnlyStatement(statement)) {
        throw new Error("该语句是只读查询，请用 db_query 执行");
      }
      if (WRITE_KEYWORDS.has(keyword)) {
        const systemRef = findSystemTableReference(statement);
        if (systemRef) {
          throw new Error(`语句涉及系统表「${systemRef}」：应用数据镜像只读，不能写入或删除`);
        }
      }
      const db = await this.open(projectId);
      const started = Date.now();
      const result = db.prepare(statement).run(...params.map(toSqlValue));
      return {
        kind: "execute",
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        elapsedMs: Date.now() - started,
        changes: Number(result.changes),
        lastInsertRowid: fromSqlValue(result.lastInsertRowid) as number | string | null,
      };
    });
  }

  /** 多条语句在一个事务里执行；任一失败整体回滚 */
  batch(
    projectId: string,
    statements: { sql: string; params?: unknown[] }[]
  ): Promise<{ results: DbQueryResult[]; elapsedMs: number }> {
    return this.run(async () => {
      if (!statements.length) throw new Error("statements 不能为空");
      if (statements.length > 200) throw new Error("单次 batch 最多 200 条语句");
      const db = await this.open(projectId);
      const started = Date.now();
      const results: DbQueryResult[] = [];
      db.exec("BEGIN");
      try {
        for (const { sql, params = [] } of statements) {
          const statement = sql.trim();
          if (!statement) throw new Error("batch 中存在空语句");
          const keyword = dbFirstKeyword(statement);
          if (WRITE_KEYWORDS.has(keyword)) {
            const systemRef = findSystemTableReference(statement);
            if (systemRef) {
              throw new Error(`语句涉及系统表「${systemRef}」：应用数据镜像只读`);
            }
          }
          if (isDbReadOnlyStatement(statement)) {
            const rows = normalizeRows(
              db.prepare(statement).all(...params.map(toSqlValue)) as Record<string, unknown>[]
            );
            results.push({
              kind: "query",
              columns: rows[0] ? Object.keys(rows[0]) : [],
              rows,
              rowCount: rows.length,
              truncated: false,
              elapsedMs: 0,
            });
          } else {
            const result = db.prepare(statement).run(...params.map(toSqlValue));
            results.push({
              kind: "execute",
              columns: [],
              rows: [],
              rowCount: 0,
              truncated: false,
              elapsedMs: 0,
              changes: Number(result.changes),
              lastInsertRowid: fromSqlValue(result.lastInsertRowid) as number | string | null,
            });
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* 连接异常时忽略回滚失败 */
        }
        throw error;
      }
      return { results, elapsedMs: Date.now() - started };
    });
  }

  createTable(projectId: string, input: DbCreateTableInput): Promise<{ table: string; inserted: number }> {
    return this.run(async () => {
      const name = assertUserTable(input.name);
      if (!input.columns.length) throw new Error("至少要有一列");
      if (input.columns.length > 100) throw new Error("单表最多 100 列");
      const seen = new Set<string>();
      for (const column of input.columns) {
        const columnName = column.name.trim();
        if (seen.has(columnName)) throw new Error(`列名「${columnName}」重复`);
        seen.add(columnName);
      }
      const db = await this.open(projectId);
      const ddl = `CREATE TABLE ${input.ifNotExists ? "IF NOT EXISTS " : ""}"${name}" (${input.columns
        .map(columnDefinition)
        .join(", ")})`;
      db.exec(ddl);
      let inserted = 0;
      if (input.rows?.length) {
        inserted = this.insertRowsSync(db, name, input.rows);
      }
      return { table: name, inserted };
    });
  }

  alterTable(projectId: string, input: DbAlterTableInput): Promise<{ table: string }> {
    return this.run(async () => {
      const table = assertIdentifier(input.table, "表名");
      assertUserTable(table);
      const db = await this.open(projectId);
      assertKnownTable(db, table);
      const statements: string[] = [];
      for (const column of input.addColumns ?? []) {
        statements.push(`ALTER TABLE "${table}" ADD COLUMN ${columnDefinition(column)}`);
      }
      for (const drop of input.dropColumns ?? []) {
        assertIdentifier(drop, "列名");
        statements.push(`ALTER TABLE "${table}" DROP COLUMN "${drop}"`);
      }
      if (input.renameColumn) {
        statements.push(
          `ALTER TABLE "${table}" RENAME COLUMN "${assertIdentifier(input.renameColumn.from, "列名")}" TO "${assertIdentifier(input.renameColumn.to, "列名")}"`
        );
      }
      if (input.renameTable) {
        assertUserTable(input.renameTable);
        statements.push(`ALTER TABLE "${table}" RENAME TO "${input.renameTable.trim()}"`);
      }
      if (!statements.length) throw new Error("没有要执行的变更");
      for (const statement of statements) db.exec(statement);
      return { table: input.renameTable?.trim() ?? table };
    });
  }

  dropTable(projectId: string, table: string): Promise<{ table: string }> {
    return this.run(async () => {
      const name = assertIdentifier(table, "表名");
      assertUserTable(name);
      const db = await this.open(projectId);
      assertKnownTable(db, name);
      db.exec(`DROP TABLE "${name}"`);
      return { table: name };
    });
  }

  insertRows(
    projectId: string,
    table: string,
    rows: Record<string, unknown>[]
  ): Promise<{ inserted: number }> {
    return this.run(async () => {
      const name = assertIdentifier(table, "表名");
      assertUserTable(name);
      const db = await this.open(projectId);
      assertKnownTable(db, name);
      return { inserted: this.insertRowsSync(db, name, rows) };
    });
  }

  updateRows(
    projectId: string,
    table: string,
    set: Record<string, unknown>,
    where: DbCondition[]
  ): Promise<{ changes: number }> {
    return this.run(async () => {
      const name = assertIdentifier(table, "表名");
      assertUserTable(name);
      if (!Object.keys(set).length) throw new Error("set 不能为空");
      if (!where.length) {
        throw new Error("必须提供 where 条件；确需全表清空请用 db_execute 执行 DELETE FROM");
      }
      const db = await this.open(projectId);
      assertKnownTable(db, name);
      const known = new Set(tableColumns(db, name));
      const assignments: string[] = [];
      const params: SqlValue[] = [];
      for (const [column, value] of Object.entries(set)) {
        if (!known.has(column)) {
          throw new Error(`表「${name}」没有列「${column}」；现有列：${[...known].join(", ")}`);
        }
        assignments.push(`"${column}" = ?`);
        params.push(toSqlValue(value));
      }
      const built = buildWhere(db, name, where);
      const result = db
        .prepare(`UPDATE "${name}" SET ${assignments.join(", ")}${built.sql}`)
        .run(...params, ...built.params);
      return { changes: Number(result.changes) };
    });
  }

  deleteRows(
    projectId: string,
    table: string,
    where: DbCondition[]
  ): Promise<{ changes: number }> {
    return this.run(async () => {
      const name = assertIdentifier(table, "表名");
      assertUserTable(name);
      if (!where.length) {
        throw new Error("必须提供 where 条件；确需全表清空请用 db_execute 执行 DELETE FROM");
      }
      const db = await this.open(projectId);
      assertKnownTable(db, name);
      const built = buildWhere(db, name, where);
      const result = db.prepare(`DELETE FROM "${name}"${built.sql}`).run(...built.params);
      return { changes: Number(result.changes) };
    });
  }

  /** 强制（或按需）重建 app_* 应用数据镜像 */
  async syncAppData(projectId: string, force: boolean): Promise<{ synced: boolean; counts: Record<string, number> }> {
    return this.run(() => this.maybeSyncAppData(projectId, force));
  }

  /* ---------- 内部 ---------- */

  private async maybeSyncAppData(
    projectId: string,
    force: boolean
  ): Promise<{ synced: boolean; counts: Record<string, number> }> {
    if (!this.appDataSource) return { synced: false, counts: {} };
    const db = await this.open(projectId);
    const last = this.readMeta(db, "last_app_sync");
    if (!force && last !== null && Date.now() - last < APP_SYNC_TTL_MS) {
      return { synced: false, counts: {} };
    }
    let snapshot: AppDataSnapshot;
    try {
      snapshot = await this.appDataSource.load(projectId);
    } catch (error) {
      // 数据源失败不应阻塞用户对自建表的操作
      console.error("[project-db] 应用数据快照加载失败：", error);
      return { synced: false, counts: {} };
    }
    const counts: Record<string, number> = {};
    db.exec("BEGIN");
    try {
      for (const def of MIRROR_DEFS) {
        db.exec(`DROP TABLE IF EXISTS "${def.table}"`);
        db.exec(
          `CREATE TABLE "${def.table}" (${def.columns
            .map((c) => `"${c.name}" ${c.type}`)
            .join(", ")})`
        );
        const rows = def.map(snapshot).slice(0, 20_000);
        if (rows.length) {
          const insert = db.prepare(
            `INSERT INTO "${def.table}" (${def.columns.map((c) => `"${c.name}"`).join(", ")}) VALUES (${def.columns
              .map(() => "?")
              .join(", ")})`
          );
          for (const row of rows) {
            insert.run(...def.columns.map((c) => toSqlValue(row[c.name])));
          }
        }
        counts[def.table] = rows.length;
      }
      this.writeMeta(db, "last_app_sync", Date.now());
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw error;
    }
    return { synced: true, counts };
  }

  private insertRowsSync(db: DatabaseSync, table: string, rows: Record<string, unknown>[]): number {
    if (!rows.length) return 0;
    if (rows.length > 2000) throw new Error("单次最多插入 2000 行");
    const known = tableColumns(db, table);
    const knownSet = new Set(known);
    const columnSet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!knownSet.has(key)) {
          throw new Error(`表「${table}」没有列「${key}」；现有列：${known.join(", ")}`);
        }
        columnSet.add(key);
      }
    }
    const columns = [...columnSet];
    const insert = db.prepare(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`
    );
    db.exec("BEGIN");
    try {
      for (const row of rows) {
        insert.run(...columns.map((c) => toSqlValue(row[c])));
      }
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw error;
    }
    return rows.length;
  }

  private async open(projectId: string): Promise<DatabaseSync> {
    const existing = this.connections.get(projectId);
    if (existing) return existing;
    const dir = workspaceDir(projectId);
    await fs.mkdir(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, DB_FILE_NAME));
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("CREATE TABLE IF NOT EXISTS _mailuo_meta (key TEXT PRIMARY KEY, value TEXT)");
    this.connections.set(projectId, db);
    return db;
  }

  private closeConnection(projectId: string): void {
    const db = this.connections.get(projectId);
    if (!db) return;
    this.connections.delete(projectId);
    try {
      db.close();
    } catch {
      /* 已关闭或损坏都忽略 */
    }
  }

  private readMeta(db: DatabaseSync, key: string): number | null {
    const row = db.prepare("SELECT value FROM _mailuo_meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    if (!row) return null;
    const parsed = Number(row.value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private writeMeta(db: DatabaseSync, key: string, value: number): void {
    db.prepare(
      "INSERT INTO _mailuo_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(key, String(value));
  }

  private run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.chain.then(action, action);
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

export const PROJECT_DB = new ProjectDbManager();

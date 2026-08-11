/**
 * 项目数据库：共享类型（主进程引擎 / 渲染进程面板 / AI 工具共用）。
 * 引擎实现见 electron/project-db.ts。
 */

export const DB_COLUMN_TYPES = ["text", "integer", "real", "blob"] as const;
export type DbColumnType = (typeof DB_COLUMN_TYPES)[number];

export interface DbColumnSpec {
  name: string;
  type: DbColumnType;
  /** NOT NULL */
  required?: boolean;
  /** UNIQUE */
  unique?: boolean;
  /** PRIMARY KEY（单列 integer 主键即自增 rowid 别名） */
  primaryKey?: boolean;
  defaultValue?: string | number | null;
}

export interface DbCreateTableInput {
  name: string;
  columns: DbColumnSpec[];
  ifNotExists?: boolean;
  /** 建表后立即插入的初始行 */
  rows?: Record<string, unknown>[];
}

export interface DbAlterTableInput {
  table: string;
  addColumns?: DbColumnSpec[];
  dropColumns?: string[];
  renameColumn?: { from: string; to: string };
  renameTable?: string;
}

export type DbWhereOp =
  | "eq"
  | "ne"
  | "gt"
  | "ge"
  | "lt"
  | "le"
  | "like"
  /** value 两侧自动加 % 的模糊匹配 */
  | "contains"
  | "in"
  | "not_in"
  | "is_null"
  | "not_null";

export interface DbCondition {
  column: string;
  op: DbWhereOp;
  /** is_null / not_null 不需要 value；in / not_in 用数组 */
  value?: unknown;
}

export interface DbTableInfo {
  name: string;
  kind: "table" | "view";
  rowCount: number;
  /** 系统表（app_* 应用数据镜像、_mailuo* 元数据）：只读，不可改不可删 */
  system: boolean;
  description?: string;
}

export interface DbColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
}

export interface DbIndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface DbDescribeResult {
  table: string;
  system: boolean;
  rowCount: number;
  columns: DbColumnInfo[];
  indexes: DbIndexInfo[];
  sampleRows: Record<string, unknown>[];
  createSql: string | null;
}

export interface DbQueryResult {
  kind: "query" | "execute";
  columns: string[];
  rows: Record<string, unknown>[];
  /** 实际返回的行数（截断后） */
  rowCount: number;
  /** true 表示还有更多行未返回 */
  truncated: boolean;
  elapsedMs: number;
  /** execute 的变更数 */
  changes?: number;
  lastInsertRowid?: number | string | null;
}

export interface DbOverview {
  projectId: string;
  path: string;
  tables: DbTableInfo[];
  /** 最近一次应用数据镜像同步时间（ms） */
  lastAppSyncAt: number | null;
}

/** 应用数据快照：主进程从各数据源收集后灌入镜像表 */
export interface AppDataSnapshot {
  projects: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  scheduledJobs: Record<string, unknown>[];
  scheduledRuns: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  memories: Record<string, unknown>[];
}

/** 只读语句的首关键字（去掉注释后） */
export const DB_READ_ONLY_KEYWORDS = ["SELECT", "WITH", "PRAGMA", "EXPLAIN"];

/** 提取去掉注释后的首个 SQL 关键字（大写） */
export function dbFirstKeyword(sql: string): string {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
  return stripped.match(/^[A-Za-z_]+/)?.[0]?.toUpperCase() ?? "";
}

/** 是否只读语句（db_query / UI 读路由用） */
export function isDbReadOnlyStatement(sql: string): boolean {
  return DB_READ_ONLY_KEYWORDS.includes(dbFirstKeyword(sql));
}

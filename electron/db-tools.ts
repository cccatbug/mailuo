/**
 * 小枢的项目数据库工具（db_*）。
 *
 * 引擎在主进程（electron/project-db.ts），不依赖渲染进程窗口：
 * 常驻小枢会话与定时任务 headless 执行都可用。
 */
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  OUTPUT_CHAR_LIMIT,
  PROJECT_DB,
} from "./project-db";
import type {
  DbColumnSpec,
  DbCondition,
} from "../src/shared/project-db";

function textResult(value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [
      {
        type: "text" as const,
        text:
          text.length > OUTPUT_CHAR_LIMIT
            ? `${text.slice(0, OUTPUT_CHAR_LIMIT)}\n…（数据库工具输出已截断，请加 LIMIT 或缩小范围）`
            : text,
      },
    ],
    details: undefined,
  };
}

function errorResult(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `数据库操作失败：${error instanceof Error ? error.message : String(error)}`,
      },
    ],
    details: undefined,
    isError: true,
  };
}

const projectIdParam = Type.Optional(
  Type.String({ description: "项目 id；留空表示当前项目" })
);

const whereCondition = Type.Object({
  column: Type.String({ description: "列名" }),
  op: Type.Union(
    [
      Type.Literal("eq"),
      Type.Literal("ne"),
      Type.Literal("gt"),
      Type.Literal("ge"),
      Type.Literal("lt"),
      Type.Literal("le"),
      Type.Literal("like"),
      Type.Literal("contains"),
      Type.Literal("in"),
      Type.Literal("not_in"),
      Type.Literal("is_null"),
      Type.Literal("not_null"),
    ],
    { description: "contains 会自动两侧加 %；in/not_in 的 value 用数组" }
  ),
  value: Type.Optional(
    Type.Unknown({ description: "比较值；is_null/not_null 省略，in/not_in 用数组" })
  ),
});

const columnSpec = Type.Object({
  name: Type.String({ description: "列名（字母/数字/下划线）" }),
  type: Type.Union([
    Type.Literal("text"),
    Type.Literal("integer"),
    Type.Literal("real"),
    Type.Literal("blob"),
  ]),
  required: Type.Optional(Type.Boolean({ description: "NOT NULL" })),
  unique: Type.Optional(Type.Boolean()),
  primaryKey: Type.Optional(
    Type.Boolean({ description: "单列 integer 主键即自增 rowid 别名" })
  ),
  defaultValue: Type.Optional(Type.Union([Type.String(), Type.Number()])),
});

const PROJECT_DB_GUIDELINES = [
  "动手前先用 db_overview / db_describe 确认真实表结构，不要凭对话记忆猜列名。",
  "app_ 前缀的表是应用数据镜像（任务、项目、定时任务、资产、记忆），只读；分析应用数据优先查询它们。",
  "用户数据请建自建表存放；表名、列名用小写蛇形命名。",
];

export function createDbTools(getProjectId: () => string | null | undefined): ToolDefinition[] {
  const resolveProjectId = (explicit: string | undefined): string => {
    const projectId = explicit?.trim() || getProjectId() || "";
    if (!projectId) throw new Error("无法确定项目：请传入 projectId 或在项目上下文中使用");
    return projectId;
  };

  return [
    defineTool({
      name: "db_overview",
      label: "数据库总览",
      description:
        "列出当前项目数据库的全部表（自建表 + app_* 应用数据镜像），含行数、系统表说明与最近一次应用数据同步时间。接触数据库的第一步。",
      promptSnippet: "查看项目数据库里有哪些表。",
      promptGuidelines: PROJECT_DB_GUIDELINES,
      parameters: Type.Object({ projectId: projectIdParam }),
      async execute(_toolCallId, params) {
        try {
          return textResult(await PROJECT_DB.overview(resolveProjectId(params.projectId)));
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    defineTool({
      name: "db_describe",
      label: "表结构详情",
      description:
        "查看一张表的结构：列与类型、索引、建表语句、样例行（5 行）。写数据前先用它核对列名。",
      promptSnippet: "查看某张表的列、索引和样例数据。",
      parameters: Type.Object({
        projectId: projectIdParam,
        table: Type.String({ description: "表名" }),
      }),
      async execute(_toolCallId, params) {
        try {
          return textResult(
            await PROJECT_DB.describeTable(resolveProjectId(params.projectId), params.table)
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    defineTool({
      name: "db_query",
      label: "SQL 查询",
      description: `在项目数据库上执行只读 SQL（SELECT / WITH / PRAGMA / EXPLAIN），支持 JOIN、聚合、窗口函数。参数用 ? 占位并按顺序传 params。默认最多返回 ${DEFAULT_QUERY_LIMIT} 行（limit 最高 ${MAX_QUERY_LIMIT}），记得加 LIMIT。`,
      promptSnippet: "用 SQL 查询项目数据库（含 app_* 应用数据镜像）。",
      promptGuidelines: [
        ...PROJECT_DB_GUIDELINES,
        "字符串、日期比较一律用 ? 参数，不要拼接进 SQL。",
        "app_tasks.tags / depends_on / schedule / tracking 是 JSON 字符串，需要时用 json_extract。",
      ],
      parameters: Type.Object({
        projectId: projectIdParam,
        sql: Type.String({ description: "只读 SQL；仅支持单条语句" }),
        params: Type.Optional(
          Type.Array(Type.Unknown(), { description: "按 ? 顺序绑定的参数值" })
        ),
        limit: Type.Optional(Type.Number({ description: `默认 ${DEFAULT_QUERY_LIMIT}` })),
      }),
      async execute(_toolCallId, params) {
        try {
          return textResult(
            await PROJECT_DB.query(
              resolveProjectId(params.projectId),
              params.sql,
              (params.params as unknown[]) ?? [],
              params.limit
            )
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    defineTool({
      name: "db_execute",
      label: "SQL 执行",
      description:
        "执行单条写 SQL：INSERT / UPDATE / DELETE / CREATE TABLE / ALTER / DROP / CREATE INDEX 等。参数用 ? 占位。涉及系统表（app_*）会被拒绝。返回变更数与最后插入的 rowid。",
      promptSnippet: "在项目数据库上执行写操作 SQL。",
      promptGuidelines: [
        ...PROJECT_DB_GUIDELINES,
        "批量写多条语句时用 db_batch（原子事务），不要循环调用 db_execute。",
        "危险操作（DROP、无 where 的批量删除）先向用户确认。",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        projectId: projectIdParam,
        sql: Type.String({ description: "单条写 SQL" }),
        params: Type.Optional(Type.Array(Type.Unknown())),
      }),
      async execute(_toolCallId, params) {
        try {
          return textResult(
            await PROJECT_DB.execute(
              resolveProjectId(params.projectId),
              params.sql,
              (params.params as unknown[]) ?? []
            )
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    defineTool({
      name: "db_batch",
      label: "批量执行（事务）",
      description:
        "在一个事务里执行多条 SQL（≤200 条），任一失败整体回滚。适合批量插入、迁移、组合变更。",
      promptSnippet: "把多条 SQL 放进一个事务执行。",
      executionMode: "sequential",
      parameters: Type.Object({
        projectId: projectIdParam,
        statements: Type.Array(
          Type.Object({
            sql: Type.String(),
            params: Type.Optional(Type.Array(Type.Unknown())),
          }),
          { minItems: 1, maxItems: 200 }
        ),
      }),
      async execute(_toolCallId, params) {
        try {
          return textResult(
            await PROJECT_DB.batch(
              resolveProjectId(params.projectId),
              params.statements as { sql: string; params?: unknown[] }[]
            )
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    defineTool({
      name: "db_create_table",
      label: "建表",
      description:
        "在当前项目数据库创建一张新表：指定列名、类型（text/integer/real/blob）、主键、非空、唯一与默认值，可同时插入初始行。单列 integer 主键自动成为自增 rowid 别名。",
      promptSnippet: "为用户的结构化数据建表。",
      promptGuidelines: [
        ...PROJECT_DB_GUIDELINES,
        "列名用小写蛇形；时间戳建议 integer（毫秒）或 text（ISO / YYYY-MM-DD）。",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        projectId: projectIdParam,
        name: Type.String({ description: "表名；app_ / _mailuo 前缀被系统保留" }),
        columns: Type.Array(columnSpec, { minItems: 1, maxItems: 100 }),
        ifNotExists: Type.Optional(Type.Boolean()),
        rows: Type.Optional(
          Type.Array(Type.Record(Type.String(), Type.Unknown()), {
            description: "建表后立即插入的行（列名 → 值）",
            maxItems: 2000,
          })
        ),
      }),
      async execute(_toolCallId, params) {
        try {
          return textResult(
            await PROJECT_DB.createTable(resolveProjectId(params.projectId), {
              name: params.name,
              columns: params.columns as DbColumnSpec[],
              ...(params.ifNotExists !== undefined ? { ifNotExists: params.ifNotExists } : {}),
              ...(params.rows ? { rows: params.rows as Record<string, unknown>[] } : {}),
            })
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    defineTool({
      name: "db_alter_table",
      label: "改表结构",
      description:
        "修改已有表：加列、删列、重命名列或重命名表。SQLite 不支持改列类型；需要时建新表迁移。",
      promptSnippet: "给表加列、删列或改名。",
      executionMode: "sequential",
      parameters: Type.Object({
        projectId: projectIdParam,
        table: Type.String(),
        addColumns: Type.Optional(Type.Array(columnSpec, { maxItems: 50 })),
        dropColumns: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })),
        renameColumn: Type.Optional(
          Type.Object({ from: Type.String(), to: Type.String() })
        ),
        renameTable: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        try {
          return textResult(
            await PROJECT_DB.alterTable(resolveProjectId(params.projectId), {
              table: params.table,
              ...(params.addColumns ? { addColumns: params.addColumns as DbColumnSpec[] } : {}),
              ...(params.dropColumns ? { dropColumns: params.dropColumns } : {}),
              ...(params.renameColumn ? { renameColumn: params.renameColumn } : {}),
              ...(params.renameTable ? { renameTable: params.renameTable } : {}),
            })
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    defineTool({
      name: "db_drop_table",
      label: "删表",
      description: "删除一张用户自建表及其全部数据。不可恢复；执行前必须确认用户确实要删。",
      promptSnippet: "删除用户明确要求删除的表。",
      executionMode: "sequential",
      parameters: Type.Object({
        projectId: projectIdParam,
        table: Type.String(),
        confirm: Type.Boolean({ description: "必须显式传 true 才会执行" }),
      }),
      async execute(_toolCallId, params) {
        try {
          if (params.confirm !== true) {
            return errorResult("删表需要 confirm=true 二次确认");
          }
          return textResult(
            await PROJECT_DB.dropTable(resolveProjectId(params.projectId), params.table)
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    defineTool({
      name: "db_insert",
      label: "插入数据",
      description:
        "向自建表批量插入行（≤2000 行/次），整批在一个事务里。行的键必须是表里已有的列。",
      promptSnippet: "往表里写数据。",
      executionMode: "sequential",
      parameters: Type.Object({
        projectId: projectIdParam,
        table: Type.String(),
        rows: Type.Array(Type.Record(Type.String(), Type.Unknown()), {
          minItems: 1,
          maxItems: 2000,
        }),
      }),
      async execute(_toolCallId, params) {
        try {
          return textResult(
            await PROJECT_DB.insertRows(
              resolveProjectId(params.projectId),
              params.table,
              params.rows as Record<string, unknown>[]
            )
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    defineTool({
      name: "db_update",
      label: "更新数据",
      description:
        "更新自建表中满足条件的行：set 指定新值，where 是条件数组（AND 连接）。必须提供 where。",
      promptSnippet: "按条件更新表里的行。",
      promptGuidelines: [
        "先用 db_query 核对会被命中的行，再执行更新。",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        projectId: projectIdParam,
        table: Type.String(),
        set: Type.Record(Type.String(), Type.Unknown(), { description: "列名 → 新值" }),
        where: Type.Array(whereCondition, { minItems: 1, maxItems: 20 }),
      }),
      async execute(_toolCallId, params) {
        try {
          return textResult(
            await PROJECT_DB.updateRows(
              resolveProjectId(params.projectId),
              params.table,
              params.set as Record<string, unknown>,
              params.where as DbCondition[]
            )
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    defineTool({
      name: "db_delete",
      label: "删除数据",
      description: "删除自建表中满足条件的行。必须提供 where；删前先用 db_query 核对命中范围。",
      promptSnippet: "按条件删除表里的行。",
      executionMode: "sequential",
      parameters: Type.Object({
        projectId: projectIdParam,
        table: Type.String(),
        where: Type.Array(whereCondition, { minItems: 1, maxItems: 20 }),
      }),
      async execute(_toolCallId, params) {
        try {
          return textResult(
            await PROJECT_DB.deleteRows(
              resolveProjectId(params.projectId),
              params.table,
              params.where as DbCondition[]
            )
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    defineTool({
      name: "db_sync_app_data",
      label: "刷新应用数据镜像",
      description:
        "强制把最新的应用数据（项目、任务、定时任务、执行历史、资产、记忆）同步进 app_* 镜像表。镜像平时自动保持新鲜（15 秒内不重复同步）；需要最新数据又怀疑镜像过期时用。",
      promptSnippet: "强制刷新 app_* 应用数据镜像。",
      parameters: Type.Object({ projectId: projectIdParam }),
      async execute(_toolCallId, params) {
        try {
          return textResult(
            await PROJECT_DB.syncAppData(resolveProjectId(params.projectId), true)
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    }),
  ];
}

import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testRoot = vi.hoisted(() => `/tmp/mailuo-project-db-${process.pid}`);
vi.mock("./pi", () => ({
  MAILUO_HOME: testRoot,
  workspaceDir: (projectId: string) =>
    path.join(testRoot, "workspace", projectId.replace(/[^\w-]/g, "")),
}));

import { ProjectDbManager } from "./project-db";
import type { AppDataSnapshot } from "../src/shared/project-db";

function makeSnapshot(): AppDataSnapshot {
  return {
    projects: [
      { id: "p1", name: "项目一", color: "#3E6B58", pinned: true, archived: false, createdAt: 1000 },
      { id: "p2", name: "项目二", color: "#3D5A80", createdAt: 2000 },
    ],
    tasks: [
      {
        id: "t1",
        projectId: "p1",
        title: "写周报",
        status: "doing",
        priority: "high",
        tags: ["汇报"],
        notes: "本周进展",
        dueDate: "2025-01-10",
        schedule: { type: "once", due: "2025-01-10" },
        tracking: { type: "standard" },
        deps: [],
        importance: 0.8,
        urgency: 0.6,
        createdAt: 111,
        completedAt: null,
      },
      {
        id: "t2",
        projectId: "p2",
        title: "调研数据库",
        status: "done",
        priority: "normal",
        tags: [],
        notes: "",
        dueDate: null,
        deps: ["t1"],
        createdAt: 222,
        completedAt: 333,
      },
    ],
    scheduledJobs: [
      {
        id: "j1",
        projectId: "p1",
        name: "周报",
        prompt: "汇总本周",
        schedule: { kind: "weekly", time: "09:00", weekdays: [5] },
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
        lastRunAt: null,
        lastStatus: null,
        nextRunAt: 999,
      },
    ],
    scheduledRuns: [
      {
        id: "r1",
        jobId: "j1",
        projectId: "p1",
        jobName: "周报",
        trigger: "schedule",
        status: "ok",
        startedAt: 10,
        finishedAt: 20,
        resultMarkdown: "# 周报",
      },
    ],
    assets: [
      {
        id: "a1",
        projectId: "p1",
        name: "笔记.md",
        relativePath: "笔记.md",
        mimeType: "text/markdown",
        size: 12,
        tags: [],
        favorite: false,
        trashed: false,
        createdAt: 5,
      },
    ],
    memories: [
      {
        id: "m1",
        key: "reply-style",
        kind: "preference",
        scope: { type: "global" },
        content: "喜欢简洁回答",
        status: "active",
        confidence: 0.9,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-02",
      },
      {
        id: "m2",
        key: "db-choice",
        kind: "project",
        scope: { type: "project", projectId: "p1" },
        content: "使用 SQLite",
        status: "active",
        confidence: 1,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-02",
      },
    ],
  };
}

function makeManager(): { manager: ProjectDbManager; loads: string[] } {
  const manager = new ProjectDbManager();
  const loads: string[] = [];
  manager.setAppDataSource({
    async load(projectId) {
      loads.push(projectId);
      return makeSnapshot();
    },
  });
  return { manager, loads };
}

describe("project-db", () => {
  beforeEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("建库、建表、插入、查询、更新、删除全链路", async () => {
    const { manager } = makeManager();
    await manager.createTable("p1", {
      name: "reading_list",
      columns: [
        { name: "id", type: "integer", primaryKey: true },
        { name: "title", type: "text", required: true },
        { name: "pages", type: "integer" },
      ],
      rows: [
        { title: "西西弗神话", pages: 160 },
        { title: "禅与摩托车维修艺术", pages: 420 },
      ],
    });

    const overview = await manager.overview("p1");
    const userTable = overview.tables.find((t) => t.name === "reading_list");
    expect(userTable?.rowCount).toBe(2);
    expect(userTable?.system).toBe(false);

    const query = await manager.query(
      "p1",
      "SELECT title, pages FROM reading_list WHERE pages > ? ORDER BY pages DESC",
      [100]
    );
    expect(query.rows.map((r) => r.title)).toEqual([
      "禅与摩托车维修艺术",
      "西西弗神话",
    ]);
    expect(query.truncated).toBe(false);

    const updated = await manager.updateRows(
      "p1",
      "reading_list",
      { pages: 999 },
      [{ column: "title", op: "eq", value: "西西弗神话" }]
    );
    expect(updated.changes).toBe(1);

    const deleted = await manager.deleteRows("p1", "reading_list", [
      { column: "pages", op: "gt", value: 500 },
    ]);
    expect(deleted.changes).toBe(1);

    const remaining = await manager.query("p1", "SELECT COUNT(*) AS c FROM reading_list");
    expect(remaining.rows[0]?.c).toBe(1);
    manager.closeAll();
  });

  it("db 文件落在项目工作目录，且每个项目相互隔离", async () => {
    const { manager } = makeManager();
    await manager.createTable("p1", { name: "a", columns: [{ name: "x", type: "text" }] });
    await manager.createTable("p2", { name: "b", columns: [{ name: "y", type: "text" }] });
    expect(manager.dbPath("p1")).toContain("/workspace/p1/mailuo.db");
    const p1Tables = (await manager.overview("p1")).tables.map((t) => t.name);
    const p2Tables = (await manager.overview("p2")).tables.map((t) => t.name);
    expect(p1Tables).toContain("a");
    expect(p1Tables).not.toContain("b");
    expect(p2Tables).toContain("b");
    manager.closeAll();
  });

  it("app_* 镜像表自动同步应用数据，可读可 JOIN，不可写", async () => {
    const { manager, loads } = makeManager();
    const overview = await manager.overview("p1");
    expect(loads).toEqual(["p1"]);
    const names = overview.tables.map((t) => t.name);
    for (const mirror of [
      "app_projects",
      "app_tasks",
      "app_scheduled_jobs",
      "app_scheduled_runs",
      "app_assets",
      "app_memories",
    ]) {
      expect(names).toContain(mirror);
    }
    expect(overview.lastAppSyncAt).not.toBeNull();

    const joined = await manager.query(
      "p1",
      `SELECT t.title, p.name FROM app_tasks t JOIN app_projects p ON p.id = t.project_id ORDER BY t.title`
    );
    // SQLite BINARY collation 按 UTF-8 字节序：「写」在「调」前
    expect(joined.rows).toEqual([
      { title: "写周报", name: "项目一" },
      { title: "调研数据库", name: "项目二" },
    ]);

    // 结构化写接口拒绝系统表
    await expect(
      manager.insertRows("p1", "app_tasks", [{ id: "x" }])
    ).rejects.toThrow(/系统表/);
    await expect(manager.dropTable("p1", "app_tasks")).rejects.toThrow(/系统表/);
    // db_execute 也拦截涉及系统表的写语句
    await expect(
      manager.execute("p1", "DELETE FROM app_tasks WHERE id = ?", ["t1"])
    ).rejects.toThrow(/系统表/);
    await expect(
      manager.execute("p1", "CREATE TABLE snapshot AS SELECT * FROM app_tasks")
    ).rejects.toThrow(/系统表/);
    // 用户表不能占用保留前缀
    await expect(
      manager.createTable("p1", { name: "app_fake", columns: [{ name: "x", type: "text" }] })
    ).rejects.toThrow(/系统表/);
    manager.closeAll();
  });

  it("镜像在 TTL 内不重复同步，force 会强制刷新", async () => {
    const { manager, loads } = makeManager();
    await manager.overview("p1");
    await manager.query("p1", "SELECT 1");
    expect(loads).toHaveLength(1);
    await manager.syncAppData("p1", true);
    expect(loads).toHaveLength(2);
    manager.closeAll();
  });

  it("db_query 拒绝写语句与带赋值的 PRAGMA；db_execute 拒绝只读语句", async () => {
    const { manager } = makeManager();
    await manager.createTable("p1", { name: "t", columns: [{ name: "x", type: "text" }] });
    await expect(manager.query("p1", "DELETE FROM t")).rejects.toThrow(/只读/);
    await expect(manager.query("p1", "PRAGMA journal_mode = OFF")).rejects.toThrow(/PRAGMA/);
    await expect(manager.execute("p1", "SELECT * FROM t")).rejects.toThrow(/db_query/);
    await expect(manager.execute("p1", "PRAGMA journal_mode = OFF")).rejects.toThrow(/只读/);
    manager.closeAll();
  });

  it("查询结果按 limit 截断并标记 truncated", async () => {
    const { manager } = makeManager();
    await manager.createTable("p1", {
      name: "nums",
      columns: [{ name: "n", type: "integer" }],
      rows: Array.from({ length: 20 }, (_, i) => ({ n: i })),
    });
    const result = await manager.query("p1", "SELECT n FROM nums", [], 5);
    expect(result.rows).toHaveLength(5);
    expect(result.truncated).toBe(true);
    manager.closeAll();
  });

  it("db_batch 在事务中执行，失败整体回滚", async () => {
    const { manager } = makeManager();
    await manager.createTable("p1", {
      name: "accounts",
      columns: [
        { name: "name", type: "text" },
        { name: "balance", type: "integer" },
      ],
      rows: [{ name: "甲", balance: 100 }],
    });
    const ok = await manager.batch("p1", [
      { sql: "UPDATE accounts SET balance = balance - ? WHERE name = ?", params: [30, "甲"] },
      { sql: "INSERT INTO accounts (name, balance) VALUES (?, ?)", params: ["乙", 30] },
    ]);
    expect(ok.results.filter((r) => r.kind === "execute")).toHaveLength(2);

    await expect(
      manager.batch("p1", [
        { sql: "UPDATE accounts SET balance = balance + 1000 WHERE name = ?", params: ["甲"] },
        { sql: "INSERT INTO nope (x) VALUES (1)" },
      ])
    ).rejects.toThrow();
    const balances = await manager.query(
      "p1",
      "SELECT name, balance FROM accounts ORDER BY name"
    );
    expect(balances.rows).toEqual([
      { name: "乙", balance: 30 },
      { name: "甲", balance: 70 },
    ]);
    manager.closeAll();
  });

  it("update / delete 强制要求 where；insert 校验列名", async () => {
    const { manager } = makeManager();
    await manager.createTable("p1", { name: "t", columns: [{ name: "x", type: "text" }] });
    await expect(manager.updateRows("p1", "t", { x: "1" }, [])).rejects.toThrow(/where/);
    await expect(manager.deleteRows("p1", "t", [])).rejects.toThrow(/where/);
    await expect(manager.insertRows("p1", "t", [{ nope: 1 }])).rejects.toThrow(/没有列/);
    manager.closeAll();
  });

  it("结构化条件覆盖常用操作符", async () => {
    const { manager } = makeManager();
    await manager.createTable("p1", {
      name: "people",
      columns: [
        { name: "name", type: "text" },
        { name: "age", type: "integer" },
        { name: "city", type: "text" },
      ],
      rows: [
        { name: "张三", age: 20, city: "杭州" },
        { name: "李四", age: 35, city: "北京" },
        { name: "王五", age: 35, city: null },
      ],
    });
    const contains = await manager.query(
      "p1",
      "SELECT name FROM people WHERE name LIKE ?",
      ["%四%"]
    );
    expect(contains.rows).toEqual([{ name: "李四" }]);

    const updated = await manager.updateRows("p1", "people", { city: "上海" }, [
      { column: "age", op: "ge", value: 35 },
      { column: "city", op: "is_null", value: undefined },
    ]);
    expect(updated.changes).toBe(1);

    const inQuery = await manager.query(
      "p1",
      "SELECT COUNT(*) AS c FROM people WHERE city IN (?, ?)",
      ["杭州", "上海"]
    );
    expect(inQuery.rows[0]?.c).toBe(2);

    const deleted = await manager.deleteRows("p1", "people", [
      { column: "name", op: "in", value: ["张三", "李四"] },
    ]);
    expect(deleted.changes).toBe(2);
    manager.closeAll();
  });

  it("alterTable 支持加列、删列、改名；dropTable 删除表", async () => {
    const { manager } = makeManager();
    await manager.createTable("p1", {
      name: "notes",
      columns: [{ name: "body", type: "text" }],
      rows: [{ body: "hello" }],
    });
    await manager.alterTable("p1", {
      table: "notes",
      addColumns: [{ name: "tag", type: "text", defaultValue: "misc" }],
    });
    const described = await manager.describeTable("p1", "notes");
    expect(described.columns.map((c) => c.name)).toEqual(["body", "tag"]);
    expect(described.sampleRows[0]?.tag).toBe("misc");

    await manager.alterTable("p1", { table: "notes", renameTable: "journal" });
    await manager.alterTable("p1", {
      table: "journal",
      renameColumn: { from: "body", to: "content" },
      dropColumns: ["tag"],
    });
    const renamed = await manager.describeTable("p1", "journal");
    expect(renamed.columns.map((c) => c.name)).toEqual(["content"]);

    await manager.dropTable("p1", "journal");
    const overview = await manager.overview("p1");
    expect(overview.tables.map((t) => t.name)).not.toContain("journal");
    manager.closeAll();
  });

  it("deleteDatabase 删除数据库文件", async () => {
    const { manager } = makeManager();
    await manager.createTable("p1", { name: "t", columns: [{ name: "x", type: "text" }] });
    const file = manager.dbPath("p1");
    await expect(fs.access(file)).resolves.toBeUndefined();
    await manager.deleteDatabase("p1");
    await expect(fs.access(file)).rejects.toThrow();
    manager.closeAll();
  });

  it("SQL 注入防护：标识符校验 + 值参数绑定", async () => {
    const { manager } = makeManager();
    await manager.createTable("p1", { name: "t", columns: [{ name: "x", type: "text" }] });
    await expect(
      manager.createTable("p1", { name: 't"; DROP TABLE t; --', columns: [{ name: "x", type: "text" }] })
    ).rejects.toThrow();
    await expect(
      manager.updateRows("p1", "t", { x: "1" }, [{ column: "x; DROP TABLE t", op: "eq", value: "1" }])
    ).rejects.toThrow();
    // 含引号的值通过参数绑定安全写入
    await manager.insertRows("p1", "t", [{ x: "'); DROP TABLE t; --" }]);
    const rows = await manager.query("p1", "SELECT x FROM t");
    expect(rows.rows[0]?.x).toBe("'); DROP TABLE t; --");
    manager.closeAll();
  });
});

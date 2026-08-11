import { create } from "zustand";
import { bridge } from "@/lib/bridge";
import type { DbDescribeResult, DbOverview, DbQueryResult } from "@/shared/project-db";

interface ProjectDbState {
  selectedProjectId: string;
  overview: DbOverview | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** 当前选中查看的表 */
  selectedTable: string | null;
  describe: DbDescribeResult | null;
  describeLoading: boolean;
  /** SQL 控制台草稿 */
  sqlDraft: string;
  /** 最近一次查询 / 执行结果 */
  lastResult: DbQueryResult | null;
  resultLoading: boolean;

  setSelectedProjectId: (projectId: string) => void;
  loadOverview: () => Promise<void>;
  selectTable: (table: string | null) => void;
  loadDescribe: () => Promise<void>;
  runSql: () => Promise<void>;
  setSqlDraft: (sql: string) => void;
  syncAppData: () => Promise<void>;
  /** 用分页 OFFSET 加载表数据 */
  loadTableRows: (offset: number, limit: number) => Promise<DbQueryResult | null>;
  deleteRow: (table: string, rowid: number) => Promise<void>;
  insertRow: (table: string, row: Record<string, unknown>) => Promise<void>;
  reset: () => void;
}

export const useProjectDbStore = create<ProjectDbState>((set, get) => ({
  selectedProjectId: "",
  overview: null,
  loading: false,
  busy: false,
  error: null,
  selectedTable: null,
  describe: null,
  describeLoading: false,
  sqlDraft: "",
  lastResult: null,
  resultLoading: false,

  setSelectedProjectId: (projectId) => set({ selectedProjectId: projectId }),

  loadOverview: async () => {
    if (!bridge) return;
    const projectId = get().selectedProjectId;
    if (!projectId) return;
    set({ loading: true, error: null });
    try {
      const overview = await bridge.dbList(projectId);
      set({ overview, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  selectTable: (table) => {
    set({ selectedTable: table, lastResult: null, describe: null });
    if (table) void get().loadDescribe();
  },

  loadDescribe: async () => {
    if (!bridge) return;
    const { selectedProjectId, selectedTable } = get();
    if (!selectedProjectId || !selectedTable) return;
    set({ describeLoading: true });
    try {
      const describe = await bridge.dbDescribe(selectedProjectId, selectedTable);
      set({ describe, describeLoading: false });
    } catch (error) {
      set({
        describeLoading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  runSql: async () => {
    if (!bridge) return;
    const { selectedProjectId, sqlDraft } = get();
    if (!selectedProjectId || !sqlDraft.trim()) return;
    set({ resultLoading: true, error: null });
    try {
      const sql = sqlDraft.trim();
      const isRead =
        /^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql);
      const result = isRead
        ? await bridge.dbQuery(selectedProjectId, sql, [], 500)
        : await bridge.dbExecute(selectedProjectId, sql, []);
      set({ lastResult: result, resultLoading: false });
    } catch (error) {
      set({
        resultLoading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  setSqlDraft: (sql) => set({ sqlDraft: sql }),

  syncAppData: async () => {
    if (!bridge) return;
    const projectId = get().selectedProjectId;
    if (!projectId) return;
    set({ busy: true });
    try {
      await bridge.dbSync(projectId, true);
      await get().loadOverview();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: false });
    }
  },

  loadTableRows: async (offset, limit) => {
    if (!bridge) return null;
    const { selectedProjectId, selectedTable } = get();
    if (!selectedProjectId || !selectedTable) return null;
    try {
      return await bridge.dbQuery(
        selectedProjectId,
        `SELECT rowid AS __rowid, * FROM "${selectedTable}" LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    } catch {
      return null;
    }
  },

  deleteRow: async (table, rowid) => {
    if (!bridge) return;
    const projectId = get().selectedProjectId;
    if (!projectId) return;
    await bridge.dbExecute(
      projectId,
      `DELETE FROM "${table}" WHERE rowid = ?`,
      [rowid]
    );
  },

  insertRow: async (table, row) => {
    if (!bridge) return;
    const projectId = get().selectedProjectId;
    if (!projectId) return;
    await bridge.dbInsert(projectId, table, [row]);
  },

  reset: () =>
    set({
      overview: null,
      error: null,
      selectedTable: null,
      describe: null,
      sqlDraft: "",
      lastResult: null,
    }),
}));

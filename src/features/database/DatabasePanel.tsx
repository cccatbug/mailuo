import { useEffect, useMemo, useState } from "react";
import {
  Database,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Terminal,
  Table2,
  ChevronLeft,
  ChevronRight,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { useProjectDbStore } from "@/store/useProjectDbStore";
import type { DbTableInfo, DbQueryResult } from "@/shared/project-db";
import { CreateTableDialog } from "./CreateTableDialog";
import { InsertRowDialog } from "./InsertRowDialog";

const ROWS_PER_PAGE = 100;

function DataGrid({
  result,
  loading,
  onOffsetChange,
  offset,
}: {
  result: DbQueryResult | null;
  loading: boolean;
  offset: number;
  onOffsetChange: (next: number) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        加载中…
      </div>
    );
  }
  if (!result) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        选择一张表查看数据，或在 SQL 控制台执行查询
      </div>
    );
  }
  if (!result.columns.length) {
    const info =
      result.kind === "execute"
        ? `执行成功，影响 ${result.changes ?? 0} 行${result.lastInsertRowid ? `，lastInsertRowid: ${result.lastInsertRowid}` : ""}`
        : "查询无结果";
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{info}</p>
        <p className="text-xs text-muted-foreground">{result.elapsedMs}ms</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="overflow-auto border rounded-md">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              {result.columns.map((col) => (
                <th
                  key={col}
                  className="whitespace-nowrap px-2.5 py-1.5 text-left font-medium text-muted-foreground"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className="border-b last:border-0 hover:bg-muted/30"
                >
                  {result.columns.map((col) => {
                    const value = row[col as keyof typeof row];
                    const display =
                      value === null
                        ? "∅"
                        : typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value);
                    return (
                      <td
                        key={col}
                        className="max-w-[300px] truncate px-2.5 py-1 text-foreground/80"
                        title={display}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
        <span>
          {result.rowCount} 行{result.truncated ? "（已截断）" : ""}
          {result.changes !== undefined ? ` · ${result.changes} 行变更` : ""}
          {" · "}
          {result.elapsedMs}ms
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={offset === 0}
            onClick={() => onOffsetChange(Math.max(0, offset - ROWS_PER_PAGE))}
          >
            <ChevronLeft />
          </Button>
          <span>
            {offset}–{offset + (result.rowCount || 0)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!result.truncated && result.rowCount < ROWS_PER_PAGE}
            onClick={() => onOffsetChange(offset + ROWS_PER_PAGE)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DatabasePanel() {
  const projects = useAppStore((s) => s.projects);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const store = useProjectDbStore();

  // 首次加载或项目切换时刷新
  useEffect(() => {
    const current = store.selectedProjectId;
    if (current) return;
    const defaultId = selectedProjectId || projects[0]?.id;
    if (defaultId) {
      store.setSelectedProjectId(defaultId);
      void store.loadOverview();
    }
  }, [selectedProjectId, projects, store.selectedProjectId]);

  const projectId = store.selectedProjectId;
  const overview = store.overview;

  const [tab, setTab] = useState<"browse" | "sql">("browse");
  const [offset, setOffset] = useState(0);
  const [browseResult, setBrowseResult] = useState<DbQueryResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [insertDialogOpen, setInsertDialogOpen] = useState(false);
  const [deletingRowid, setDeletingRowid] = useState<number | null>(null);

  const userTables = useMemo(
    () => (overview?.tables ?? []).filter((t) => !t.system),
    [overview]
  );
  const systemTables = useMemo(
    () => (overview?.tables ?? []).filter((t) => t.system),
    [overview]
  );

  const loadBrowse = async (table: string, newOffset: number) => {
    if (!table) return;
    setBrowseLoading(true);
    const result = await store.loadTableRows(newOffset, ROWS_PER_PAGE);
    setBrowseResult(result);
    setBrowseLoading(false);
  };

  const handleSelectTable = (table: string) => {
    store.selectTable(table);
    setOffset(0);
    setBrowseResult(null);
    void loadBrowse(table, 0);
  };

  const handleOffset = (next: number) => {
    setOffset(next);
    if (store.selectedTable) void loadBrowse(store.selectedTable, next);
  };

  const handleDeleteRow = async () => {
    if (deletingRowid === null || !store.selectedTable) return;
    try {
      await store.deleteRow(store.selectedTable, deletingRowid);
      toast.success("已删除");
      setDeletingRowid(null);
      void loadBrowse(store.selectedTable, offset);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const handleInsertRow = async (row: Record<string, unknown>) => {
    if (!store.selectedTable) return;
    await store.insertRow(store.selectedTable, row);
    toast.success("已插入");
    void loadBrowse(store.selectedTable, offset);
  };

  const refresh = async () => {
    await store.loadOverview();
    if (store.selectedTable) {
      void loadBrowse(store.selectedTable, offset);
    }
  };

  const changeProject = (id: string) => {
    store.reset();
    setBrowseResult(null);
    setOffset(0);
    store.setSelectedProjectId(id);
    void store.loadOverview();
  };

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Database className="size-4 text-primary" />
        <Select value={projectId} onValueChange={changeProject}>
          <SelectTrigger className="h-7 w-[200px] text-xs">
            <SelectValue placeholder="选择项目" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: p.color }}
                  />
                  {p.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={refresh}
          disabled={store.loading}
          title="刷新"
        >
          <RefreshCw
            className={cn("size-3.5", store.loading && "animate-spin")}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void store.syncAppData()}
          disabled={store.busy}
          title="同步应用数据到 app_* 镜像表"
        >
          <Shield className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCreateTableOpen(true)}
          title="新建数据表"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      {/* 表名列表 + 主内容 */}
      <div className="flex min-h-0 flex-1">
        {/* 侧栏 */}
        <div className="flex w-52 shrink-0 flex-col border-r">
          <div className="flex border-b px-3 py-1.5 text-[10px] font-medium text-muted-foreground gap-1">
            <button
              className={cn(
                "flex-1 rounded px-1 py-0.5",
                tab === "browse" && "bg-accent text-accent-foreground"
              )}
              onClick={() => setTab("browse")}
            >
              <Table2 className="mr-1 inline size-3" />
              浏览
            </button>
            <button
              className={cn(
                "flex-1 rounded px-1 py-0.5",
                tab === "sql" && "bg-accent text-accent-foreground"
              )}
              onClick={() => setTab("sql")}
            >
              <Terminal className="mr-1 inline size-3" />
              SQL
            </button>
          </div>
          <ScrollArea className="flex-1">
            {store.loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="p-1">
                {/* 用户表 */}
                {userTables.length > 0 && (
                  <div className="mb-1">
                    <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      数据表
                    </div>
                    {userTables.map((t) => (
                      <TableItem
                        key={t.name}
                        table={t}
                        active={store.selectedTable === t.name && tab === "browse"}
                        onSelect={() => {
                          setTab("browse");
                          handleSelectTable(t.name);
                        }}
                      />
                    ))}
                  </div>
                )}
                {/* 系统镜像表 */}
                {systemTables.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      应用数据（只读）
                    </div>
                    {systemTables.map((t) => (
                      <TableItem
                        key={t.name}
                        table={t}
                        active={store.selectedTable === t.name && tab === "browse"}
                        onSelect={() => {
                          setTab("browse");
                          handleSelectTable(t.name);
                        }}
                      />
                    ))}
                  </div>
                )}
                {!userTables.length && !systemTables.length && !store.loading && (
                  <p className="px-2 py-4 text-xs text-muted-foreground">
                    暂无表，用 SQL 控制台或 AI 小枢建表。
                  </p>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* 主区域 */}
        <div className="flex min-w-0 flex-1 flex-col p-3">
          {store.error && (
            <div className="mb-2 rounded bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
              {store.error}
            </div>
          )}

          {tab === "sql" ? (
            /* SQL 控制台 */
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="relative min-h-[120px] flex-1">
                <textarea
                  className="h-full w-full resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none focus:border-primary/50"
                  placeholder={`-- 输入 SQL，⌘/Ctrl+Enter 执行\n-- 读操作用 db_query，写操作用 db_execute\n-- app_* 表是应用数据镜像（只读）\nSELECT * FROM app_tasks LIMIT 10;`}
                  value={store.sqlDraft}
                  onChange={(e) => store.setSqlDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      void store.runSql();
                    }
                  }}
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  disabled={store.resultLoading || !store.sqlDraft.trim()}
                  onClick={() => void store.runSql()}
                >
                  {store.resultLoading && (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  )}
                  执行 (⌘↩)
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {store.lastResult
                    ? `${store.lastResult.kind === "execute" ? "执行" : "查询"} · ${store.lastResult.elapsedMs}ms`
                    : ""}
                </span>
              </div>
              <div className="min-h-0 flex-1">
                <DataGrid
                  result={store.lastResult}
                  loading={store.resultLoading}
                  offset={0}
                  onOffsetChange={() => {}}
                />
              </div>
            </div>
          ) : (
            /* 表浏览 */
            <div className="flex min-h-0 flex-1 flex-col">
              {store.selectedTable ? (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-sm font-medium">
                      {store.selectedTable}
                      {store.describe?.system && (
                        <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          只读
                        </span>
                      )}
                    </h3>
                    <span className="text-[11px] text-muted-foreground">
                      {store.describe?.columns.length ?? 0} 列 ·{" "}
                      {store.describe?.rowCount ?? "?"} 行
                    </span>
                    <div className="flex-1" />
                    {store.describe && !store.describe.system && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setInsertDialogOpen(true)}
                          title="插入行"
                        >
                          <Plus className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            const rowid = prompt("输入要删除的 rowid（从数据网格第一列查看）");
                            if (rowid && /^\d+$/.test(rowid)) {
                              setDeletingRowid(Number(rowid));
                            }
                          }}
                          title="按 rowid 删除行"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                  {store.describe && (
                    <div className="mb-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                      {store.describe.columns.map((c) => (
                        <span
                          key={c.name}
                          className="rounded border px-1.5 py-0.5"
                          title={`${c.type}${c.primaryKey ? " PK" : ""}${c.notNull ? " NOT NULL" : ""}`}
                        >
                          {c.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <DataGrid
                    result={browseResult}
                    loading={browseLoading}
                    offset={offset}
                    onOffsetChange={handleOffset}
                  />
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  从左侧选择一张表，或切换到 SQL 控制台
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 对话框 */}
      <CreateTableDialog
        open={createTableOpen}
        onOpenChange={setCreateTableOpen}
        onCreated={() => {
          void refresh();
        }}
      />
      {store.selectedTable && store.describe && (
        <InsertRowDialog
          open={insertDialogOpen}
          onOpenChange={setInsertDialogOpen}
          columns={store.describe.columns}
          table={store.selectedTable}
          onInsert={(row) => void handleInsertRow(row)}
        />
      )}
      {/* 删除确认 */}
      {deletingRowid !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10">
          <div className="w-80 rounded-xl border bg-popover p-4 text-sm shadow-lg">
            <p>
              确认删除 rowid = <strong>{deletingRowid}</strong>？
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeletingRowid(null)}>
                取消
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void handleDeleteRow()}>
                删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TableItem({
  table,
  active,
  onSelect,
}: {
  table: DbTableInfo;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
      onClick={onSelect}
    >
      {table.system ? (
        <Shield className="size-3 shrink-0" />
      ) : (
        <Table2 className="size-3 shrink-0" />
      )}
      <span className="truncate">{table.name}</span>
      <span className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground/60">
        {table.rowCount}
      </span>
    </button>
  );
}

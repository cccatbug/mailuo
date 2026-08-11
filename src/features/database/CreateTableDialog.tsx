import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bridge } from "@/lib/bridge";
import { useProjectDbStore } from "@/store/useProjectDbStore";
import type { DbColumnSpec, DbColumnType } from "@/shared/project-db";

const COLUMN_TYPES: DbColumnType[] = ["text", "integer", "real", "blob"];

interface ColumnDraft {
  key: string;
  name: string;
  type: DbColumnType;
  primaryKey: boolean;
  required: boolean;
  unique: boolean;
}

export function CreateTableDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const projectId = useProjectDbStore((s) => s.selectedProjectId);
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([
    { key: "0", name: "id", type: "integer", primaryKey: true, required: false, unique: false },
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addColumn = () => {
    setColumns((prev) => [
      ...prev,
      { key: crypto.randomUUID(), name: "", type: "text", primaryKey: false, required: false, unique: false },
    ]);
  };

  const removeColumn = (key: string) => {
    if (columns.length <= 1) return;
    setColumns((prev) => prev.filter((c) => c.key !== key));
  };

  const updateColumn = (key: string, patch: Partial<ColumnDraft>) => {
    setColumns((prev) =>
      prev.map((c) => (c.key === key ? { ...c, ...patch } : c))
    );
  };

  const submit = async () => {
    if (!bridge || !projectId) return;
    const valid = validate();
    if (valid) {
      setError(valid);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await bridge.dbCreateTable(projectId, {
        name: name.trim(),
        columns: columns.map(
          (c): DbColumnSpec => ({
            name: c.name.trim(),
            type: c.type,
            ...(c.primaryKey ? { primaryKey: true } : {}),
            ...(c.required && !c.primaryKey ? { required: true } : {}),
            ...(c.unique && !c.primaryKey ? { unique: true } : {}),
          })
        ),
      });
      onCreated();
      onOpenChange(false);
      setName("");
      setColumns([
        { key: "0", name: "id", type: "integer", primaryKey: true, required: false, unique: false },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建表失败");
    } finally {
      setCreating(false);
    }
  };

  const validate = (): string | null => {
    if (!name.trim()) return "请输入表名";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim())) return "表名只能包含字母、数字、下划线，且不能以数字开头";
    const seen = new Set<string>();
    for (const c of columns) {
      if (!c.name.trim()) return "每列都需要名称";
      if (seen.has(c.name.trim())) return `列名「${c.name}」重复`;
      seen.add(c.name.trim());
    }
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建数据表</DialogTitle>
          <DialogDescription>
            定义表名与列结构；单列 integer 主键自动成为自增 rowid。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>表名</FieldLabel>
            <Input
              autoFocus
              value={name}
              maxLength={64}
              placeholder="例如：weekly_report"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">列定义</span>
              <Button variant="ghost" size="icon-sm" onClick={addColumn}>
                <Plus className="size-3.5" />
              </Button>
            </div>
            <div className="max-h-64 space-y-2 overflow-auto">
              {columns.map((col) => (
                <div key={col.key} className="flex items-center gap-1.5">
                  <Input
                    className="h-7 flex-1 text-xs"
                    placeholder="列名"
                    value={col.name}
                    maxLength={40}
                    onChange={(e) => updateColumn(col.key, { name: e.target.value })}
                  />
                  <Select
                    value={col.type}
                    onValueChange={(v) => updateColumn(col.key, { type: v as DbColumnType })}
                  >
                    <SelectTrigger className="h-7 w-20 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLUMN_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={col.primaryKey}
                      onChange={(e) => updateColumn(col.key, { primaryKey: e.target.checked })}
                    />
                    PK
                  </label>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={columns.length <= 1}
                    onClick={() => removeColumn(col.key)}
                    className="size-6 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={creating}>
            {creating && <Loader2 className="size-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
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
import type { DbColumnInfo } from "@/shared/project-db";

export function InsertRowDialog({
  open,
  onOpenChange,
  columns,
  table,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: DbColumnInfo[];
  table: string;
  onInsert: (row: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  const submit = () => {
    const row: Record<string, unknown> = {};
    for (const col of columns) {
      const raw = (values[col.name] ?? "").trim();
      if (raw === "") {
        row[col.name] = null;
      } else if (col.type.toUpperCase() === "INTEGER") {
        const num = Number(raw);
        row[col.name] = Number.isFinite(num) ? num : raw;
      } else if (col.type.toUpperCase() === "REAL") {
        const num = Number(raw);
        row[col.name] = Number.isFinite(num) ? num : raw;
      } else {
        row[col.name] = raw;
      }
    }
    onInsert(row);
    onOpenChange(false);
    setValues({});
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) setValues({});
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>插入行 · {table}</DialogTitle>
          <DialogDescription>
            留空视为 NULL；主键列若自增可留空。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          {columns
            .filter((c) => c.name !== "__rowid")
            .map((col) => (
              <Field key={col.name}>
                <FieldLabel>
                  {col.name}
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {col.type}
                    {col.primaryKey ? " · PK" : ""}
                  </span>
                </FieldLabel>
                <Input
                  className="h-8 text-xs"
                  placeholder={col.primaryKey ? "自动生成" : col.notNull ? "必填" : "可选"}
                  value={values[col.name] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [col.name]: e.target.value }))
                  }
                />
              </Field>
            ))}
        </FieldGroup>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit}>插入</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

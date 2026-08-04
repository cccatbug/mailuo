import { useCallback, useMemo, useState } from "react";
import { ChevronsUpDown, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  COMMON_SYSTEM_FONTS,
  querySystemFontFamilies,
  quoteFontFamily,
} from "@/lib/system-fonts";

type FontLoadState = "idle" | "loading" | "ready" | "fallback";

export function SystemFontPicker({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [families, setFamilies] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<FontLoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  const availableFamilies = useMemo(() => {
    const values = new Set(families);
    if (value) values.add(value);
    return [...values];
  }, [families, value]);

  const loadFonts = useCallback(async () => {
    if (loadState === "loading") return;
    setLoadState("loading");
    setLoadError(null);
    try {
      const systemFamilies = await querySystemFontFamilies();
      setFamilies(systemFamilies);
      setLoadState("ready");
    } catch (error) {
      setFamilies([...COMMON_SYSTEM_FONTS]);
      setLoadState("fallback");
      setLoadError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "未获得系统字体权限，当前显示常用字体。点击刷新可重试。"
          : "无法枚举系统字体，当前显示常用字体。"
      );
    }
  }, [loadState]);

  return (
    <div className="w-full space-y-2">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen && loadState === "idle") void loadFonts();
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span
              className="truncate"
              style={value ? { fontFamily: quoteFontFamily(value) } : undefined}
            >
              {value || "应用默认字体"}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0">
          <Command>
            <CommandInput placeholder="搜索系统字体…" />
            <CommandList className="max-h-80">
              <CommandEmpty>
                {loadState === "loading" ? "正在读取系统字体…" : "没有匹配的字体"}
              </CommandEmpty>
              <CommandItem
                value="应用默认字体 default"
                data-checked={!value}
                onSelect={() => {
                  onValueChange("");
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>应用默认字体</span>
                  <span className="text-xs text-muted-foreground">脉络内置的中西文字体组合</span>
                </span>
              </CommandItem>
              {loadState === "loading" && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  正在读取系统字体…
                </div>
              )}
              {loadState !== "loading" &&
                availableFamilies.map((family) => (
                  <CommandItem
                    key={family}
                    value={family}
                    data-checked={value === family}
                    onSelect={() => {
                      onValueChange(family);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-muted-foreground">
                        {family}
                      </span>
                      <span
                        className="block truncate text-base"
                        style={{ fontFamily: quoteFontFamily(family) }}
                      >
                        脉络 Mailuo 0123
                      </span>
                    </span>
                  </CommandItem>
                ))}
            </CommandList>
          </Command>
          <div className="flex items-center gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span className="min-w-0 flex-1">
              {loadState === "ready"
                ? `已读取 ${families.length} 个系统字体族`
                : loadError || "打开后会请求系统字体访问权限"}
            </span>
            {loadState === "fallback" && (
              <Button
                variant="ghost"
                size="icon-sm"
                title="重新读取系统字体"
                onClick={() => void loadFonts()}
              >
                <RefreshCw />
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <div
        className="rounded-lg border bg-muted/20 px-4 py-3"
        style={value ? { fontFamily: quoteFontFamily(value) } : undefined}
      >
        <p className="text-base">山川异域，风月同天。Mailuo 0123456789</p>
        <p className="mt-1 text-xs text-muted-foreground">
          字体预览 · 备注、输入框、正文与标题都会使用此字体
        </p>
      </div>
    </div>
  );
}

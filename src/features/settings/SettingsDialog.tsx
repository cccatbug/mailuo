import { useEffect, useState } from "react";
import {
  Bot,
  Copy,
  Database,
  FolderOpen,
  Globe2,
  Info,
  MoonStar,
  Monitor,
  Palette,
  RotateCcw,
  SunMedium,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { bridge } from "@/lib/bridge";
import { hasNative } from "@/lib/platform";
import { useAppStore } from "@/store/useAppStore";
import type { ThemeMode, ThemePalette } from "@/lib/theme";
import { seedData } from "@/store/seed";
import { BrowserSettingsPane } from "./BrowserSettingsPane";
import {
  isShuSection,
  ShuSettingsPane,
  type ShuSection,
} from "./ShuSettingsPane";
import { SystemFontPicker } from "./SystemFontPicker";
import packageInfo from "../../../package.json";

/* ---------- Obsidian 式设置行：左侧名称+描述，右侧控件 ---------- */

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-8 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm">{title}</p>
        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-7 mb-1 text-sm font-semibold first:mt-0">{children}</h3>
  );
}

/* ---------- 各分区 ---------- */

function AppearancePane() {
  const { t } = useTranslation();
  const themeMode = useAppStore((s) => s.themeMode);
  const themePalette = useAppStore((s) => s.themePalette);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const setThemePalette = useAppStore((s) => s.setThemePalette);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const palettes: ThemePalette[] = [
    "white",
    "paper",
    "moon",
    "celadon",
    "graphite",
  ];
  return (
    <div>
      <SectionHeading>{t("appearance.theme")}</SectionHeading>
      <SettingRow
        title={t("appearance.mode")}
        description={t("appearance.modeDescription")}
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={themeMode}
          onValueChange={(value) =>
            value && setThemeMode(value as ThemeMode)
          }
        >
          <ToggleGroupItem value="system">
            <Monitor />
            {t("appearance.system")}
          </ToggleGroupItem>
          <ToggleGroupItem value="light">
            <SunMedium />
            {t("appearance.light")}
          </ToggleGroupItem>
          <ToggleGroupItem value="dark">
            <MoonStar />
            {t("appearance.dark")}
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>
      <SettingRow
        title={t("appearance.palette")}
        description={t("appearance.paletteDescription")}
      >
        <ToggleGroup
          type="single"
          value={themePalette}
          onValueChange={(value) =>
            value && setThemePalette(value as ThemePalette)
          }
          className="grid w-72 grid-cols-2 gap-2"
        >
          {palettes.map((palette) => (
            <ToggleGroupItem
              key={palette}
              value={palette}
              data-palette-preview={palette}
              className="h-auto justify-start gap-2 rounded-lg border p-2 text-left text-xs transition-colors hover:bg-accent data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:ring-2 data-[state=on]:ring-ring/40"
            >
              <span className="theme-palette-swatch size-5 shrink-0 rounded-full border" />
              {t(`appearance.${palette}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingRow>

      <SectionHeading>{t("appearance.interface")}</SectionHeading>
      <SettingRow
        title={t("appearance.language")}
        description={t("appearance.languageDescription")}
      >
        <Select
          value={settings.locale}
          onValueChange={(locale) =>
            setSettings({ locale: locale === "en" ? "en" : "zh-CN" })
          }
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh-CN">简体中文</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title="界面缩放" description="整体等比缩放，适配不同屏幕密度。">
        <Select
          value={String(settings.uiScale)}
          onValueChange={(v) => setSettings({ uiScale: Number(v) })}
        >
          <SelectTrigger size="sm" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {["0.9", "1", "1.1", "1.25"].map((v) => (
                <SelectItem key={v} value={v}>
                  {Math.round(Number(v) * 100)}%
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingRow>

      <SectionHeading>字体</SectionHeading>
      <SettingRow
        title="应用字体"
        description="从电脑已安装的字体中选择，并应用到界面正文、标题、输入框和备注。首次展开时会读取系统字体。"
      >
        <div className="w-96">
          <SystemFontPicker
            value={settings.appFontFamily}
            onValueChange={(appFontFamily) => setSettings({ appFontFamily })}
          />
        </div>
      </SettingRow>
    </div>
  );
}

function DataPane() {
  const replaceData = useAppStore((s) => s.replaceData);
  const [dataDir, setDataDir] = useState<string>("");
  const b = bridge;

  useEffect(() => {
    if (b) {
      b.getDataDir()
        .then(setDataDir)
        .catch(() => setDataDir(""));
    }
  }, [b]);

  const exportJson = async () => {
    const { projects, tasks, tagLibrary } = useAppStore.getState();
    const json = JSON.stringify(
      { version: 4, projects, tasks, tagLibrary },
      null,
      2
    );
    await navigator.clipboard.writeText(json);
    toast.success("数据 JSON 已复制到剪贴板");
  };

  return (
    <div>
      <SectionHeading>存储</SectionHeading>
      <SettingRow
        title="数据位置"
        description={
          <span className="font-mono break-all">
            {hasNative ? dataDir || "读取中…" : "浏览器 localStorage"}
          </span>
        }
      >
        {b && dataDir && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              b.openDataDir().catch((e: unknown) =>
                toast.error("打开目录失败", { description: String(e) })
              )
            }
          >
            <FolderOpen data-icon="inline-start" />
            打开
          </Button>
        )}
      </SettingRow>
      <SettingRow title="导出数据" description="把全部项目与任务复制为 JSON。">
        <Button variant="outline" size="sm" onClick={exportJson}>
          <Copy data-icon="inline-start" />
          复制
        </Button>
      </SettingRow>

      <SectionHeading>标签库</SectionHeading>
      <TagLibraryRow />

      <SectionHeading>危险区</SectionHeading>
      <SettingRow
        title="重置为示例数据"
        description="当前所有项目与任务将被替换为初始示例，无法撤销。"
      >
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
            >
              <RotateCcw data-icon="inline-start" />
              重置
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>重置全部数据？</AlertDialogTitle>
              <AlertDialogDescription>
                建议先「导出数据」留底，此操作无法撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  const seed = seedData();
                  replaceData(seed.projects, seed.tasks);
                  toast.success("已重置为示例数据");
                }}
              >
                重置
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingRow>
    </div>
  );
}

function TagLibraryRow() {
  const tagLibrary = useAppStore((s) => s.tagLibrary);
  const removeTagFromLibrary = useAppStore((s) => s.removeTagFromLibrary);
  return (
    <SettingRow
      title="全局标签"
      description="任务与项目共用的标签库；移除仅影响后续选择，不清除已打的标签。"
    >
      <div className="flex max-w-56 flex-wrap justify-end gap-1">
        {tagLibrary.length === 0 && (
          <span className="text-xs text-muted-foreground">暂无标签</span>
        )}
        {tagLibrary.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
          >
            #{t}
            <button
              aria-label={`移除 ${t}`}
              className="rounded-full p-0.5 hover:bg-foreground/10"
              onClick={() => removeTagFromLibrary(t)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </SettingRow>
  );
}

function AboutPane() {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-xl bg-primary font-heading text-3xl font-bold text-primary-foreground">
        脉
      </div>
      <div>
        <p className="font-heading text-lg font-bold tracking-[0.3em]">脉络</p>
        <p className="text-xs text-muted-foreground">MÀI LUÒ · v{packageInfo.version}</p>
      </div>
      <p className="max-w-64 text-sm text-muted-foreground">
        项目驱动、以依赖为脉络的待办应用。米纸为底，松墨为骨，朱砂点睛。
      </p>
      <p className="text-xs text-muted-foreground">
        Electron · React 19 · shadcn/ui · @xyflow/react · pi SDK
      </p>
    </div>
  );
}

/* ---------- 主对话框：左导航 + 右内容（Obsidian 式浮空模态框） ---------- */

const PANES = [
  { key: "appearance", label: "外观", icon: Palette, pane: AppearancePane },
  { key: "shu", label: "小枢", icon: Bot },
  { key: "browser", label: "浏览器", icon: Globe2, pane: BrowserSettingsPane },
  { key: "data", label: "数据", icon: Database, pane: DataPane },
  { key: "about", label: "关于", icon: Info, pane: AboutPane },
] as const;

type PaneKey = (typeof PANES)[number]["key"];

/** v0.25 之前的独立入口 → 统一「小枢」面板的分节。 */
const LEGACY_PANE_TO_SECTION: Record<string, ShuSection> = {
  ai: "providers",
  "pi-extensions": "extensions",
  "pi-skills": "skills",
  assistant: "permissions",
  memory: "memory",
};

export function SettingsDialog() {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const [active, setActive] = useState<PaneKey>("appearance");
  const [shuSection, setShuSection] = useState<ShuSection>("permissions");

  useEffect(() => {
    const openPane = (event: Event) => {
      const detail = String((event as CustomEvent<string>).detail);
      // 新格式：shu 或 shu:<section>
      if (detail === "shu" || detail.startsWith("shu:")) {
        setActive("shu");
        const section = detail.split(":")[1] as ShuSection | undefined;
        if (section && isShuSection(section)) setShuSection(section);
        return;
      }
      // 旧入口（ai / pi-extensions / pi-skills / assistant / memory）映射到小枢分节
      const legacy = LEGACY_PANE_TO_SECTION[detail];
      if (legacy) {
        setActive("shu");
        setShuSection(legacy);
        return;
      }
      if (PANES.some((pane) => pane.key === detail)) {
        setActive(detail as PaneKey);
      }
    };
    window.addEventListener("mailuo-open-settings-pane", openPane);
    return () => window.removeEventListener("mailuo-open-settings-pane", openPane);
  }, []);

  const activeItem = PANES.find((p) => p.key === active);
  const ActivePane =
    activeItem && "pane" in activeItem ? activeItem.pane : AppearancePane;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[82vh] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="sr-only">
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>外观、小枢与数据管理。</DialogDescription>
        </DialogHeader>

        <nav className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-sidebar/60 p-3">
          <p className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
            选项
          </p>
          {PANES.map((p) => (
            <button
              key={p.key}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                active === p.key
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
              onClick={() => setActive(p.key)}
            >
              <p.icon className="size-4" />
              {p.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
          {active === "shu" ? (
            <ShuSettingsPane
              section={shuSection}
              onSectionChange={setShuSection}
            />
          ) : (
            <ActivePane />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

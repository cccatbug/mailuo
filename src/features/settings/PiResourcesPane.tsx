import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Box,
  Code2,
  Download,
  ExternalLink,
  FolderOpen,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { bridge } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import type { AiConfigSnapshot } from "@/shared/ai-config";
import type {
  PiExtensionCatalogItem,
  PiPackagePreview,
  PiResourcePathSummary,
  PiResourcesSnapshot,
  PiSkillResource,
  SkillsShCatalogItem,
  SkillsShListResult,
} from "@/shared/pi-resources";
import { useAiConfigStore } from "@/store/useAiConfigStore";
import { usePiResourcesStore } from "@/store/usePiResourcesStore";

export type PiResourcesPaneKind = "extension" | "skill";

type OperationResult = {
  snapshot: AiConfigSnapshot;
  resources: PiResourcesSnapshot;
};

type InstallPreview =
  | { kind: "extension"; package: PiPackagePreview }
  | {
      kind: "skill";
      source: string;
      skills: Array<{ name: string; description?: string }>;
      catalog?: SkillsShCatalogItem;
    };

function sourceLabel(sourceKind: string): string {
  return {
    package: "pi package",
    local: "本地路径",
    terminal: "终端导入",
    "skills-sh": "skills.sh",
  }[sourceKind] ?? sourceKind;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function ResourceBadge({ children }: { children: React.ReactNode }) {
  return <Badge variant="secondary" className="font-normal">{children}</Badge>;
}

function ResourceEmpty({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function ResourceRow({
  icon,
  title,
  description,
  path,
  source,
  enabled,
  onToggle,
  onOpen,
  openTitle = "打开路径",
  openIcon = <FolderOpen />,
  onDelete,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  path: string;
  source: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onOpen: () => void;
  openTitle?: string;
  openIcon?: React.ReactNode;
  onDelete?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border p-3", !enabled && "opacity-60")}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-medium">{title}</p>
            {!enabled && <ResourceBadge>已停用</ResourceBadge>}
          </div>
          {description && <div className="mt-1 text-xs text-muted-foreground">{description}</div>}
          <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={path}>{path}</p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground" title={source}>{source}</p>
          {children}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Checkbox
            checked={enabled}
            onCheckedChange={(value) => onToggle(value === true)}
            aria-label={`${title} 启用`}
          />
          <Button variant="ghost" size="icon-sm" onClick={onOpen} title={openTitle}>
            {openIcon}
          </Button>
          {onDelete && (
            <Button variant="ghost" size="icon-sm" onClick={onDelete} title="移除">
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchBox({
  value,
  placeholder,
  loading,
  onChange,
  onSearch,
}: {
  value: string;
  placeholder: string;
  loading: boolean;
  onChange: (value: string) => void;
  onSearch: () => void;
}) {
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <InputGroup>
        <InputGroupAddon><Search /></InputGroupAddon>
        <InputGroupInput
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </InputGroup>
      <Button type="submit" variant="outline" disabled={value.trim().length < 2 || loading}>
        {loading ? <Spinner data-icon="inline-start" /> : <Search data-icon="inline-start" />}
        搜索
      </Button>
    </form>
  );
}

function ExtensionCatalogResults({
  results,
  previewing,
  onPreview,
}: {
  results: PiExtensionCatalogItem[];
  previewing: string | null;
  onPreview: (item: PiExtensionCatalogItem) => void;
}) {
  if (results.length === 0) return null;
  return (
    <div className="max-h-80 overflow-y-auto rounded-xl border">
      {results.map((item) => (
        <div key={item.source} className="flex items-start gap-3 border-b p-3 last:border-b-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><Code2 /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-sm font-medium">{item.name}</p>
              {item.version && <ResourceBadge>v{item.version}</ResourceBadge>}
              <ResourceBadge>{formatCount(item.downloads)}/月</ResourceBadge>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
            {item.author && <p className="mt-1 text-[11px] text-muted-foreground">作者：{item.author}</p>}
          </div>
          <Button size="sm" variant="outline" disabled={previewing !== null} onClick={() => onPreview(item)}>
            {previewing === item.source ? <Spinner data-icon="inline-start" /> : <Box data-icon="inline-start" />}
            预览
          </Button>
        </div>
      ))}
    </div>
  );
}

function SkillCatalogResults({
  results,
  previewing,
  onPreview,
}: {
  results: SkillsShCatalogItem[];
  previewing: string | null;
  onPreview: (item: SkillsShCatalogItem) => void;
}) {
  if (results.length === 0) return null;
  return (
    <div className="max-h-80 overflow-y-auto rounded-xl border">
      {results.map((item) => (
        <div key={item.id} className="flex items-start gap-3 border-b p-3 last:border-b-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><BookOpen /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-sm font-medium">{item.name}</p>
              <ResourceBadge>{item.installsLabel} 次安装</ResourceBadge>
            </div>
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{item.source}</p>
          </div>
          <Button size="sm" variant="outline" disabled={previewing !== null} onClick={() => onPreview(item)}>
            {previewing === item.id ? <Spinner data-icon="inline-start" /> : <Box data-icon="inline-start" />}
            预览
          </Button>
        </div>
      ))}
    </div>
  );
}

export function PiResourcesPane({ kind }: { kind: PiResourcesPaneKind }) {
  const snapshot = usePiResourcesStore((state) => state.snapshot);
  const loading = usePiResourcesStore((state) => state.loading);
  const error = usePiResourcesStore((state) => state.error);
  const progress = usePiResourcesStore((state) => state.progress);
  const load = usePiResourcesStore((state) => state.load);
  const refresh = usePiResourcesStore((state) => state.refresh);
  const setResources = usePiResourcesStore((state) => state.setSnapshot);
  const setProgress = usePiResourcesStore((state) => state.setProgress);
  const aiSnapshot = useAiConfigStore((state) => state.snapshot);
  const loadAiConfig = useAiConfigStore((state) => state.load);
  const [query, setQuery] = useState("");
  const [extensionResults, setExtensionResults] = useState<PiExtensionCatalogItem[]>([]);
  const [skillResults, setSkillResults] = useState<SkillsShCatalogItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [installPreview, setInstallPreview] = useState<InstallPreview | null>(null);
  const [customSource, setCustomSource] = useState("");
  const [customSkillNames, setCustomSkillNames] = useState("");
  const [pathSourceKind, setPathSourceKind] = useState<"local" | "terminal">("local");
  const [busy, setBusy] = useState<string | null>(null);
  const [skillEditor, setSkillEditor] = useState<{ mode: "new" | "edit"; id?: string; root?: string } | null>(null);
  const [skillName, setSkillName] = useState("");
  const [skillContent, setSkillContent] = useState("");
  const [skillLoading, setSkillLoading] = useState(false);

  useEffect(() => {
    void Promise.all([load(), loadAiConfig()]).catch(() => undefined);
  }, [load, loadAiConfig]);

  useEffect(() => {
    if (!bridge?.onPiResourceProgress) return;
    return bridge.onPiResourceProgress(setProgress);
  }, [setProgress]);

  const profiles = aiSnapshot?.config.contextProfiles ?? [];
  const resources = kind === "extension" ? snapshot?.extensions ?? [] : snapshot?.skills ?? [];
  const paths = useMemo(
    () => snapshot?.paths.filter((entry) => entry.kind === kind) ?? [],
    [kind, snapshot?.paths]
  );
  const packages = useMemo(
    () => snapshot?.packages.filter((entry) =>
      kind === "extension" ? entry.resources.extensions > 0 || !entry.installed : entry.resources.skills > 0
    ) ?? [],
    [kind, snapshot?.packages]
  );

  const commit = (result: OperationResult) => {
    setResources(result.resources);
    useAiConfigStore.setState({ snapshot: result.snapshot });
    window.dispatchEvent(new Event("mailuo-ai-runtime-changed"));
  };

  const run = async (
    label: string,
    action: () => Promise<OperationResult | PiResourcesSnapshot>
  ): Promise<boolean> => {
    setBusy(label);
    try {
      const result = await action();
      if ("snapshot" in result) commit(result);
      else setResources(result);
      toast.success("操作完成");
      return true;
    } catch (cause) {
      toast.error("操作失败", { description: String(cause) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const searchCatalog = async () => {
    if (!bridge || query.trim().length < 2) return;
    setSearching(true);
    setSearched(true);
    try {
      if (kind === "extension") {
        setExtensionResults(await bridge.searchPiExtensions(query.trim()));
      } else {
        setSkillResults(await bridge.searchSkillsSh(query.trim()));
      }
    } catch (cause) {
      toast.error("搜索失败", { description: String(cause) });
    } finally {
      setSearching(false);
    }
  };

  const previewExtension = async (source: string) => {
    if (!bridge) return;
    setPreviewing(source);
    try {
      setInstallPreview({ kind: "extension", package: await bridge.previewPiPackage(source) });
    } catch (cause) {
      toast.error("无法生成安装预览", { description: String(cause) });
    } finally {
      setPreviewing(null);
    }
  };

  const previewSkill = async (
    source: string,
    requestedNames: string[],
    catalog?: SkillsShCatalogItem
  ) => {
    if (!bridge) return;
    setPreviewing(catalog?.id ?? source);
    try {
      const listing: SkillsShListResult = await bridge.listSkillsSh(source);
      const skills = requestedNames.length > 0
        ? requestedNames.map((name) => listing.skills.find((item) => item.name === name) ?? { name })
        : listing.skills;
      if (skills.length === 0) throw new Error("该来源没有发现可安装的 Skill");
      setInstallPreview({ kind: "skill", source, skills, ...(catalog ? { catalog } : {}) });
    } catch (cause) {
      toast.error("无法生成安装预览", { description: String(cause) });
    } finally {
      setPreviewing(null);
    }
  };

  const confirmInstall = async () => {
    if (!bridge || !installPreview) return;
    const nativeBridge = bridge;
    if (installPreview.kind === "extension") {
      const source = installPreview.package.source;
      const ok = await run("package-install", () => nativeBridge.installPiPackage(source));
      if (ok) {
        setInstallPreview(null);
        setCustomSource("");
      }
      return;
    }
    const source = installPreview.source;
    const names = installPreview.skills.map((skill) => skill.name);
    const ok = await run("skills-sh-install", () => nativeBridge.installSkillsSh(source, names));
    if (ok) {
      setInstallPreview(null);
      setCustomSource("");
      setCustomSkillNames("");
    }
  };

  const openSkill = async (skill: PiSkillResource) => {
    setSkillEditor({ mode: "edit", id: skill.id });
    setSkillName(skill.name);
    setSkillLoading(true);
    try {
      setSkillContent((await bridge?.readPiSkill(skill.id)) ?? "");
    } catch (cause) {
      toast.error("读取 Skill 失败", { description: String(cause) });
      setSkillEditor(null);
    } finally {
      setSkillLoading(false);
    }
  };

  const saveSkill = async () => {
    if (!skillEditor) return;
    setBusy("skill-save");
    try {
      if (skillEditor.mode === "new") {
        const result = await bridge?.createPiSkill(skillName, skillContent, skillEditor.root);
        if (result) commit(result);
      } else if (skillEditor.id) {
        const result = await bridge?.writePiSkill(skillEditor.id, skillContent);
        if (result) commit(result);
      }
      setSkillEditor(null);
      toast.success("Skill 已保存");
    } catch (cause) {
      toast.error("保存 Skill 失败", { description: String(cause) });
    } finally {
      setBusy(null);
    }
  };

  if (loading && !snapshot) {
    return <div className="flex h-72 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />正在扫描 pi 资源</div>;
  }
  if (!snapshot) {
    return (
      <Alert variant="destructive">
        <ShieldAlert />
        <AlertTitle>无法读取资源</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  const isExtension = kind === "extension";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-lg font-semibold">{isExtension ? "扩展" : "技能"}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {isExtension
              ? "从 pi.dev 查找扩展，统一管理启停与来源。扩展在 Electron 主进程中运行，请只安装可信代码。"
              : "从 skills.sh 查找技能，并按上下文配置档控制可用范围。安装内容保存在应用独立目录。"}
          </p>
          {progress && <p className="mt-2 text-[11px] text-primary">{progress.message || `${progress.action}: ${progress.source}`}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw data-icon="inline-start" />刷新
          </Button>
          {busy && <Button variant="outline" size="sm" onClick={() => void bridge?.cancelPiResourceOperation()}>取消</Button>}
        </div>
      </div>

      {snapshot.diagnostics.length > 0 && (
        <Alert>
          <ShieldAlert />
          <AlertTitle>资源诊断</AlertTitle>
          <AlertDescription>
            {snapshot.diagnostics.map((item, index) => (
              <p key={`${item.message}-${index}`}>{item.message}{item.path ? `：${item.path}` : ""}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isExtension ? "在 pi.dev 查找扩展" : "在 skills.sh 查找技能"}</CardTitle>
          <CardDescription>
            搜索不会安装任何内容。选择结果后会先展示来源、内容和安装范围，再由你确认。
          </CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => void bridge?.openExternal(isExtension ? "https://pi.dev/packages?type=extension" : "https://skills.sh")}>
              <ExternalLink data-icon="inline-start" />打开目录
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <SearchBox
            value={query}
            placeholder={isExtension ? "搜索扩展名称、描述或作者" : "搜索技能名称或用途"}
            loading={searching}
            onChange={setQuery}
            onSearch={() => void searchCatalog()}
          />
          {isExtension ? (
            <ExtensionCatalogResults
              results={extensionResults}
              previewing={previewing}
              onPreview={(item) => void previewExtension(item.source)}
            />
          ) : (
            <SkillCatalogResults
              results={skillResults}
              previewing={previewing}
              onPreview={(item) => void previewSkill(item.source, [item.name], item)}
            />
          )}
          {searched && !searching && (isExtension ? extensionResults.length === 0 : skillResults.length === 0) && (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">没有找到匹配结果，尝试更短或更具体的关键词。</p>
          )}
          <details className="group rounded-lg border px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground group-open:text-foreground">
              {isExtension ? "通过 package 地址安装" : "通过仓库地址安装"}
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <InputGroup>
                  <InputGroupAddon>{isExtension ? <Package /> : <BookOpen />}</InputGroupAddon>
                  <InputGroupInput
                    value={customSource}
                    placeholder={isExtension ? "npm:... / git:... / /absolute/path" : "owner/repo 或 Git URL"}
                    onChange={(event) => setCustomSource(event.target.value)}
                  />
                </InputGroup>
                {!isExtension && (
                  <InputGroup className="max-w-56">
                    <InputGroupInput
                      value={customSkillNames}
                      placeholder="Skill 名称，可留空"
                      onChange={(event) => setCustomSkillNames(event.target.value)}
                    />
                  </InputGroup>
                )}
                <Button
                  variant="outline"
                  disabled={!customSource.trim() || previewing !== null}
                  onClick={() => {
                    if (isExtension) void previewExtension(customSource.trim());
                    else void previewSkill(
                      customSource.trim(),
                      customSkillNames.split(/[,，]/).map((value) => value.trim()).filter(Boolean)
                    );
                  }}
                >
                  {previewing === customSource.trim() ? <Spinner data-icon="inline-start" /> : <Box data-icon="inline-start" />}
                  生成预览
                </Button>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <SectionHeading
          title={isExtension ? "已安装扩展" : "已安装技能"}
          description={isExtension ? "扩展启停对所有对话生效。" : "技能可按上下文配置档启用，也可以直接编辑 SKILL.md。"}
          action={isExtension
            ? <ResourceBadge>{resources.length} 个</ResourceBadge>
            : <Button size="sm" onClick={() => {
                setSkillName("");
                setSkillContent("");
                setSkillEditor({ mode: "new" });
              }}><Plus data-icon="inline-start" />新建技能</Button>}
        />
        {isExtension ? (
          snapshot.extensions.length === 0 ? (
            <ResourceEmpty icon={<Code2 />} title="还没有扩展" description="在上方搜索 pi.dev，或从 package 地址与本地路径添加。" />
          ) : snapshot.extensions.map((extension) => (
            <ResourceRow
              key={extension.id}
              icon={<Code2 />}
              title={extension.name}
              description={<span className="flex flex-wrap gap-1"><ResourceBadge>{sourceLabel(extension.sourceKind)}</ResourceBadge>{extension.version && <ResourceBadge>v{extension.version}</ResourceBadge>}</span>}
              path={extension.path}
              source={extension.source}
              enabled={extension.enabled}
              onToggle={(enabled) => void run("extension-toggle", () => bridge!.setPiExtensionEnabled(extension.id, enabled))}
              onOpen={() => void bridge?.openPiResource(extension.path)}
            />
          ))
        ) : (
          <SkillsSection
            skills={snapshot.skills}
            profiles={profiles}
            onOpen={openSkill}
            onToggle={(skill, enabled) => void run("skill-toggle", () => bridge!.setPiSkillProfiles(skill.id, enabled ? null : []))}
            onProfiles={(skill, ids) => void run("skill-profiles", () => bridge!.setPiSkillProfiles(skill.id, ids.length === profiles.length ? null : ids))}
          />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <SectionHeading
          title="安装来源"
          description={isExtension
            ? "更新、停用或移除应用管理的 pi package。"
            : "技能可能来自 pi package 或 skills.sh；这里统一管理它们的更新与删除。"}
          action={packages.length > 0
            ? <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void run("package-update", () => bridge!.updatePiPackage())}><RotateCw data-icon="inline-start" />更新 Packages</Button>
            : undefined}
        />
        {packages.length === 0 && (isExtension || snapshot.skillsShInstalls.length === 0) && (
          <ResourceEmpty
            icon={isExtension ? <Package /> : <BookOpen />}
            title="没有安装来源"
            description={isExtension ? "从 pi.dev 或 package 地址安装后会显示在这里。" : "从 skills.sh 或包含技能的 pi package 安装后会显示在这里。"}
          />
        )}
        {packages.map((pkg) => (
          <PackageRow
            key={pkg.source}
            pkg={pkg}
            busy={!!busy}
            onToggle={(enabled) => void run("package-toggle", () => bridge!.setPiPackageEnabled(pkg.source, enabled))}
            onUpdate={() => void run("package-update", () => bridge!.updatePiPackage(pkg.source))}
            onRemove={() => void run("package-remove", () => bridge!.removePiPackage(pkg.source))}
          />
        ))}
        {!isExtension && snapshot.skillsShInstalls.map((install) => (
          <div className="flex items-start justify-between gap-3 rounded-xl border p-3" key={install.id}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <BookOpen />
                <p className="truncate text-sm font-medium">{install.source}</p>
                <ResourceBadge>skills.sh</ResourceBadge>
                <ResourceBadge>{install.skillNames.length || "全部"} 个技能</ResourceBadge>
              </div>
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{install.root}</p>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon-sm" title="更新" onClick={() => void run("skills-sh-update", () => bridge!.updateSkillsSh(install.id, install.skillNames))}><RotateCw /></Button>
              <Button variant="ghost" size="icon-sm" title="删除" onClick={() => void run("skills-sh-remove", () => bridge!.removeSkillsSh(install.id))}><Trash2 /></Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <SectionHeading
          title="自定义路径"
          description={isExtension ? "登记本地扩展目录或终端 pi 已安装的扩展。" : "登记本地技能目录或终端工具已安装的技能。"}
          action={(
            <div className="flex gap-2">
              <Select value={pathSourceKind} onValueChange={(value) => setPathSourceKind(value as "local" | "terminal")}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="local">本地路径</SelectItem>
                    <SelectItem value="terminal">终端安装目录</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!!busy}
                onClick={() => void bridge!.pickPiPath(kind).then(async (selected) => {
                  if (selected) await run("path-add", () => bridge!.addPiPath(kind, selected, pathSourceKind));
                })}
              >
                <Plus data-icon="inline-start" />选择并登记
              </Button>
            </div>
          )}
        />
        {paths.length === 0 ? (
          <ResourceEmpty icon={<FolderOpen />} title="没有自定义路径" description="应用不会自动读取 ~/.pi、项目 .pi 或 ~/.agents。" />
        ) : paths.map((entry) => (
          <PathRow
            key={`${entry.kind}:${entry.path}`}
            entry={entry}
            onToggle={(enabled) => void run("path-toggle", () => bridge!.setPiPathEnabled(entry.kind, entry.path, enabled))}
            onRemove={() => void run("path-remove", () => bridge!.removePiPath(entry.kind, entry.path))}
            onOpen={() => void bridge?.openPiResource(entry.path)}
          />
        ))}
      </div>

      <InstallPreviewDialog
        preview={installPreview}
        busy={!!busy}
        onOpenChange={(open) => !open && !busy && setInstallPreview(null)}
        onConfirm={() => void confirmInstall()}
      />

      <Dialog open={skillEditor !== null} onOpenChange={(open) => !open && setSkillEditor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{skillEditor?.mode === "new" ? "新建技能" : `编辑技能：${skillName}`}</DialogTitle>
            <DialogDescription>技能使用 Agent Skills 标准的 SKILL.md，保存后会立即参与资源扫描。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="skill-name">名称</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="skill-name"
                  value={skillName}
                  disabled={skillEditor?.mode === "edit"}
                  placeholder="skill-name（小写字母、数字、连字符）"
                  onChange={(event) => setSkillName(event.target.value)}
                />
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="skill-content">SKILL.md</FieldLabel>
              <Textarea
                id="skill-content"
                className="min-h-[360px] font-mono text-xs"
                value={skillLoading ? "读取中…" : skillContent}
                disabled={skillLoading}
                onChange={(event) => setSkillContent(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSkillEditor(null)}>取消</Button>
            <Button disabled={skillLoading || !!busy || !skillName.trim()} onClick={() => void saveSkill()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InstallPreviewDialog({
  preview,
  busy,
  onOpenChange,
  onConfirm,
}: {
  preview: InstallPreview | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={preview !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>确认安装</DialogTitle>
          <DialogDescription>请核对来源和即将写入应用资源目录的内容。</DialogDescription>
        </DialogHeader>
        {preview?.kind === "extension" && (
          <div className="flex flex-col gap-4">
            <Alert>
              <ShieldAlert />
              <AlertTitle>扩展拥有 Electron 主进程权限</AlertTitle>
              <AlertDescription>安装后仅在你启用时加载，但运行期间可以访问主进程可访问的文件与网络。</AlertDescription>
            </Alert>
            <Card size="sm">
              <CardHeader>
                <CardTitle>{preview.package.name}</CardTitle>
                <CardDescription>{preview.package.description || "该来源没有提供 package 描述。"}</CardDescription>
                {preview.package.version && <CardAction><ResourceBadge>v{preview.package.version}</ResourceBadge></CardAction>}
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-xs">
                <PreviewLine label="来源" value={preview.package.source} mono />
                {preview.package.author && <PreviewLine label="作者" value={preview.package.author} />}
                {preview.package.license && <PreviewLine label="许可证" value={preview.package.license} />}
                <PreviewLine
                  label="扩展入口"
                  value={preview.package.extensions.length > 0 ? preview.package.extensions.join("、") : "manifest 未显式列出，将由 pi 在安装后扫描"}
                  mono
                />
                {preview.package.skills.length > 0 && <PreviewLine label="同时包含技能" value={preview.package.skills.join("、")} mono />}
              </CardContent>
            </Card>
          </div>
        )}
        {preview?.kind === "skill" && (
          <div className="flex flex-col gap-4">
            <Alert>
              <BookOpen />
              <AlertTitle>技能将复制到应用独立目录</AlertTitle>
              <AlertDescription>不会写入 ~/.pi 或 ~/.agents。技能内容会在匹配任务时加入模型上下文。</AlertDescription>
            </Alert>
            <Card size="sm">
              <CardHeader>
                <CardTitle>{preview.skills.length === 1 ? preview.skills[0].name : `${preview.skills.length} 个技能`}</CardTitle>
                <CardDescription>{preview.source}</CardDescription>
                {preview.catalog && <CardAction><ResourceBadge>{preview.catalog.installsLabel} 次安装</ResourceBadge></CardAction>}
              </CardHeader>
              <CardContent className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {preview.skills.map((skill) => (
                  <div key={skill.name} className="rounded-lg border p-2.5">
                    <p className="text-sm font-medium">{skill.name}</p>
                    {skill.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{skill.description}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={busy} onClick={onConfirm}>
            {busy ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            确认安装
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("break-all", mono && "font-mono text-[11px]")}>{value}</span>
    </div>
  );
}

function SkillsSection({
  skills,
  profiles,
  onOpen,
  onToggle,
  onProfiles,
}: {
  skills: PiSkillResource[];
  profiles: Array<{ id: string; name: string }>;
  onOpen: (skill: PiSkillResource) => void;
  onToggle: (skill: PiSkillResource, enabled: boolean) => void;
  onProfiles: (skill: PiSkillResource, ids: string[]) => void;
}) {
  if (skills.length === 0) {
    return <ResourceEmpty icon={<BookOpen />} title="还没有技能" description="在上方搜索 skills.sh、通过仓库安装，或新建 SKILL.md。" />;
  }
  return (
    <div className="flex flex-col gap-3">
      {skills.map((skill) => (
        <ResourceRow
          key={skill.id}
          icon={<BookOpen />}
          title={skill.name}
          description={skill.description}
          path={skill.filePath}
          source={skill.source}
          enabled={skill.enabled && (skill.profileIds === null || skill.profileIds.length > 0)}
          onToggle={(enabled) => onToggle(skill, enabled)}
          onOpen={() => onOpen(skill)}
          openTitle="查看和编辑"
          openIcon={<Pencil />}
        >
          <div className="mt-2 flex flex-wrap gap-1">
            <ResourceBadge>{sourceLabel(skill.sourceKind)}</ResourceBadge>
            {skill.profileIds === null ? <ResourceBadge>全部配置档</ResourceBadge> : profiles.map((profile) => (
              <button
                type="button"
                key={profile.id}
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[10px]",
                  skill.profileIds?.includes(profile.id) ? "border-primary bg-primary/10" : "text-muted-foreground"
                )}
                onClick={() => {
                  const ids = new Set(skill.profileIds ?? profiles.map((item) => item.id));
                  if (ids.has(profile.id)) ids.delete(profile.id);
                  else ids.add(profile.id);
                  onProfiles(skill, [...ids]);
                }}
              >
                {profile.name}
              </button>
            ))}
          </div>
        </ResourceRow>
      ))}
    </div>
  );
}

function PackageRow({
  pkg,
  busy,
  onToggle,
  onUpdate,
  onRemove,
}: {
  pkg: PiResourcesSnapshot["packages"][number];
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onUpdate: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Package />
            <p className="truncate text-sm font-medium">{pkg.source}</p>
            {pkg.version && <ResourceBadge>v{pkg.version}</ResourceBadge>}
            {!pkg.installed && <Badge variant="destructive">未安装</Badge>}
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{pkg.installedPath || "等待安装"}</p>
          <p className="mt-1 text-xs text-muted-foreground">发现 {pkg.resources.extensions} 个扩展、{pkg.resources.skills} 个技能</p>
        </div>
        <div className="flex gap-1">
          <Checkbox checked={pkg.enabled} onCheckedChange={(value) => onToggle(value === true)} aria-label="启用 package" />
          <Button variant="ghost" size="icon-sm" disabled={busy} title="更新" onClick={onUpdate}><RotateCw /></Button>
          <Button variant="ghost" size="icon-sm" disabled={busy} title="移除" onClick={onRemove}><Trash2 /></Button>
        </div>
      </div>
      {pkg.diagnostics.map((item, index) => <p className="mt-2 text-xs text-destructive" key={`${item.message}-${index}`}>{item.message}</p>)}
    </div>
  );
}

function PathRow({
  entry,
  onToggle,
  onRemove,
  onOpen,
}: {
  entry: PiResourcePathSummary;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  return (
    <ResourceRow
      icon={entry.kind === "extension" ? <Code2 /> : <BookOpen />}
      title={entry.path}
      description={`${entry.resourceCount} 个资源`}
      path={entry.path}
      source={sourceLabel(entry.sourceKind)}
      enabled={entry.enabled}
      onToggle={onToggle}
      onOpen={onOpen}
      onDelete={onRemove}
    >
      {entry.diagnostics.map((item, index) => <p className="mt-2 text-xs text-destructive" key={`${item.message}-${index}`}>{item.message}</p>)}
    </ResourceRow>
  );
}

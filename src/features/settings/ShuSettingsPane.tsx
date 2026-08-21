import { useEffect, useState } from "react";
import {
  BookOpen,
  Bot,
  BrainCircuit,
  Code2,
  Copy,
  Cpu,
  FileStack,
  FolderOpen,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { bridge } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { useAiConfigStore } from "@/store/useAiConfigStore";
import { usePiResourcesStore } from "@/store/usePiResourcesStore";
import {
  ContextPane,
  ModelsPane,
  NetworkPane,
  PromptTemplatesPane,
  ProviderPane,
  RoutesPane,
  useAiConfigDraft,
  type AiSection,
} from "./AiSettingsPane";
import { AssistantPermissionsSection } from "./AssistantSettingsPane";
import { MemorySettingsPane } from "./MemorySettingsPane";
import { PiResourcesPane } from "./PiResourcesPane";

/** 统一「小枢」面板的分节。 */
export type ShuSection =
  | "permissions"
  | AiSection
  | "extensions"
  | "skills"
  | "memory";

export function isShuSection(value: unknown): value is ShuSection {
  return SHU_SECTIONS.some((section) => section.key === value);
}

const SHU_SECTIONS: Array<{
  key: ShuSection;
  label: string;
  icon: typeof Cpu;
}> = [
  { key: "permissions", label: "权限", icon: ShieldCheck },
  { key: "providers", label: "Provider", icon: Server },
  { key: "models", label: "模型", icon: Sparkles },
  { key: "routes", label: "路由", icon: RefreshCw },
  { key: "context", label: "上下文", icon: FileStack },
  { key: "prompts", label: "提示词", icon: Copy },
  { key: "network", label: "网络", icon: Network },
  { key: "extensions", label: "扩展", icon: Code2 },
  { key: "skills", label: "技能", icon: BookOpen },
  { key: "memory", label: "记忆", icon: BrainCircuit },
];

const AI_SECTION_KEYS = new Set<ShuSection>([
  "providers",
  "models",
  "routes",
  "prompts",
  "context",
  "network",
]);

function isAiSection(section: ShuSection): section is AiSection {
  return AI_SECTION_KEYS.has(section);
}

/* ---------- 概览状态条 ---------- */

function StatChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[10px] text-muted-foreground">
          {label}
        </span>
        <span className="block truncate text-sm font-medium">{value}</span>
      </span>
    </div>
  );
}

/* ---------- AI 配置分区（Provider/模型/路由/上下文/提示词/网络） ---------- */

type AiConfigDraft = ReturnType<typeof useAiConfigDraft>;

function AiConfigSection({
  section,
  draft,
}: {
  section: AiSection;
  draft: AiConfigDraft;
}) {
  const { loading, error, config, setConfig, saveConfig, reload } = draft;

  if (loading && !config) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        正在加载 AI 配置
      </div>
    );
  }
  if (!config) {
    return (
      <div className="rounded-lg border border-destructive/30 p-4 text-sm">
        <p className="font-medium text-destructive">无法读取 AI 配置</p>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        <Button className="mt-3" variant="outline" onClick={() => void reload()}>
          <RefreshCw />
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
        <p className="min-w-0 text-[11px] leading-relaxed text-muted-foreground">
          配置来源{" "}
          <span className="font-mono">~/.mailuo/ai/config.json</span>，不读取
          ~/.pi、项目 .pi、~/.agents 或登录 shell 凭据。
        </p>
        <div className="flex shrink-0 gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void bridge
                ?.openAiConfigDir()
                .catch((cause) => toast.error("打开目录失败", { description: String(cause) }))
            }
          >
            <FolderOpen />
            打开目录
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void reload()
                .then(() => toast.success("已重新加载 config.json"))
                .catch((cause) =>
                  toast.error("重新加载失败", { description: String(cause) })
                )
            }
          >
            <RefreshCw />
            重新加载
          </Button>
        </div>
      </div>

      {section === "providers" && (
        <ProviderPane config={config} setConfig={setConfig} onSave={saveConfig} />
      )}
      {section === "models" && (
        <ModelsPane config={config} setConfig={setConfig} onSave={saveConfig} />
      )}
      {section === "routes" && (
        <RoutesPane config={config} setConfig={setConfig} onSave={saveConfig} />
      )}
      {section === "prompts" && <PromptTemplatesPane />}
      {section === "context" && (
        <ContextPane config={config} setConfig={setConfig} onSave={saveConfig} />
      )}
      {section === "network" && (
        <NetworkPane config={config} setConfig={setConfig} onSave={saveConfig} />
      )}
    </div>
  );
}

/* ---------- 统一「小枢」面板 ---------- */

export function ShuSettingsPane({
  section: activeSection,
  onSectionChange,
}: {
  section: ShuSection;
  onSectionChange: (section: ShuSection) => void;
}) {
  const { t } = useTranslation();
  const mode = useAppStore((s) => s.settings.assistantPermissionMode);
  const aiSnapshot = useAiConfigStore((s) => s.snapshot);
  const piSnapshot = usePiResourcesStore((s) => s.snapshot);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  // AI 配置草稿提升到面板层：在 AI 各分节间切换不丢未保存的编辑
  const aiDraft = useAiConfigDraft();

  useEffect(() => {
    // 预取概览数据：各 store 幂等，后续分节会复用同一份快照
    void useAiConfigStore.getState().load().catch(() => undefined);
    void usePiResourcesStore.getState().load().catch(() => undefined);
    void bridge
      ?.getMemory()
      .then((snapshot) =>
        setMemoryCount(
          snapshot.entries.filter((entry) => entry.status === "active").length
        )
      )
      .catch(() => undefined);
  }, []);

  const enabledProviders = aiSnapshot
    ? aiSnapshot.config.providers.filter((provider) => provider.enabled).length
    : null;
  const enabledModels = aiSnapshot
    ? aiSnapshot.config.models.filter((model) => model.enabled).length
    : null;
  const extensions = piSnapshot?.extensions.length ?? null;
  const skills = piSnapshot?.skills.length ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bot className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-heading text-xl font-bold">小枢</h2>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            权限、模型与能力的一站式配置：Provider、模型路由、上下文、提示词、
            网络、扩展、技能与记忆集中在这里。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <StatChip
          icon={<ShieldCheck className="size-3.5" />}
          label="权限模式"
          value={t(`assistant.modes.${mode}`)}
        />
        <StatChip
          icon={<Server className="size-3.5" />}
          label="Provider"
          value={enabledProviders ?? "—"}
        />
        <StatChip
          icon={<Sparkles className="size-3.5" />}
          label="已启用模型"
          value={enabledModels ?? "—"}
        />
        <StatChip
          icon={<Code2 className="size-3.5" />}
          label="扩展"
          value={extensions ?? "—"}
        />
        <StatChip
          icon={<BookOpen className="size-3.5" />}
          label="技能"
          value={skills ?? "—"}
        />
        <StatChip
          icon={<BrainCircuit className="size-3.5" />}
          label="记忆"
          value={memoryCount === null ? "—" : memoryCount}
        />
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1">
        {SHU_SECTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors",
              activeSection === item.key
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => onSectionChange(item.key)}
          >
            <item.icon className="size-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      {activeSection === "permissions" && <AssistantPermissionsSection />}
      {isAiSection(activeSection) && (
        <AiConfigSection section={activeSection} draft={aiDraft} />
      )}
      {(activeSection === "extensions" || activeSection === "skills") && (
        <PiResourcesPane kind={activeSection === "extensions" ? "extension" : "skill"} />
      )}
      {activeSection === "memory" && <MemorySettingsPane />}
    </div>
  );
}

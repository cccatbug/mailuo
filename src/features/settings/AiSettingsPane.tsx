import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  FolderOpen,
  KeyRound,
  Network,
  Plus,
  RefreshCw,
  Save,
  Server,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bridge } from "@/lib/bridge";
import { isSubmitKey } from "@/lib/keyboard";
import {
  AI_API_TYPES,
  AI_PROVIDER_PRESETS,
  AI_THINKING_LEVELS,
  AI_USE_CASES,
  collectAiConfigReferences,
  modelRefKey,
  usesDeepSeekWebSearch,
  type AiApiType,
  type AiAuthMode,
  type AiConfigV1,
  type AiContextProfile,
  type AiCredentialDraft,
  type AiDiscoveryAdapter,
  type AiModelConfig,
  type AiProviderConfig,
  type AiProviderPreset,
  type AiThinkingLevel,
  type AiUseCase,
  type DiscoveredModel,
} from "@/shared/ai-config";
import { useAiConfigStore } from "@/store/useAiConfigStore";
import { cn } from "@/lib/utils";
import {
  loadPromptTemplates,
  savePromptTemplates,
  type PromptKind,
  type PromptTemplate,
} from "@/features/ai/promptTemplates";

type AiSection = "providers" | "models" | "routes" | "prompts" | "context" | "network";

const USE_CASE_LABELS: Record<AiUseCase, string> = {
  assistant: "助手",
  "project-plan": "项目规划",
  "task-breakdown": "任务拆解",
  "dependency-suggest": "依赖建议",
  "notes-polish": "备注润色",
};

const PRESETS: Record<
  AiProviderPreset,
  {
    label: string;
    baseUrl: string;
    api: AiApiType;
    authMode: AiAuthMode;
    discovery: AiDiscoveryAdapter;
  }
> = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-responses",
    authMode: "api-key",
    discovery: "openai",
  },
  anthropic: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
    authMode: "api-key",
    discovery: "anthropic",
  },
  gemini: {
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "google-generative-ai",
    authMode: "api-key",
    discovery: "gemini",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
    authMode: "api-key",
    discovery: "openai",
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    api: "openai-responses",
    authMode: "api-key",
    discovery: "openai",
  },
  qwen: {
    label: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api: "openai-completions",
    authMode: "api-key",
    discovery: "openai",
  },
  kimi: {
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    api: "openai-completions",
    authMode: "api-key",
    discovery: "openai",
  },
  minimax: {
    label: "MiniMax",
    baseUrl: "https://api.minimax.io/v1",
    api: "openai-completions",
    authMode: "api-key",
    discovery: "openai",
  },
  zai: {
    label: "Z.AI",
    baseUrl: "https://api.z.ai/api/paas/v4",
    api: "openai-completions",
    authMode: "api-key",
    discovery: "openai",
  },
  xai: {
    label: "xAI",
    baseUrl: "https://api.x.ai/v1",
    api: "openai-completions",
    authMode: "api-key",
    discovery: "openai",
  },
  mistral: {
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    api: "mistral-conversations",
    authMode: "api-key",
    discovery: "openai",
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    api: "openai-completions",
    authMode: "api-key",
    discovery: "openai",
  },
  ollama: {
    label: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    api: "openai-completions",
    authMode: "none",
    discovery: "ollama",
  },
  "lm-studio": {
    label: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    api: "openai-completions",
    authMode: "none",
    discovery: "openai",
  },
  custom: {
    label: "自定义 Provider",
    baseUrl: "http://127.0.0.1:8000/v1",
    api: "openai-completions",
    authMode: "api-key",
    discovery: "openai",
  },
};

const SECTION_ITEMS: Array<{
  key: AiSection;
  label: string;
  icon: typeof Server;
}> = [
  { key: "providers", label: "Provider", icon: Server },
  { key: "models", label: "已启用模型", icon: Sparkles },
  { key: "routes", label: "用途路由", icon: RefreshCw },
  { key: "prompts", label: "提示词模板", icon: Copy },
  { key: "context", label: "上下文配置档", icon: Copy },
  { key: "network", label: "网络", icon: Network },
];

function createProvider(preset: AiProviderPreset): AiProviderConfig {
  const defaults = PRESETS[preset];
  return {
    id: crypto.randomUUID(),
    name: defaults.label,
    preset,
    enabled: true,
    baseUrl: defaults.baseUrl,
    api: defaults.api,
    authMode: defaults.authMode,
    authHeader: defaults.authMode === "api-key",
    headers: {},
    secretHeaderNames: [],
    discovery: { adapter: defaults.discovery },
  };
}

function baseUrlForProtocol(
  provider: AiProviderConfig,
  api: AiApiType
): string {
  if (provider.preset !== "deepseek") return provider.baseUrl;
  try {
    const url = new URL(provider.baseUrl);
    if (url.hostname !== "api.deepseek.com") return provider.baseUrl;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (api === "anthropic-messages" && (path === "/" || path === "/v1")) {
      url.pathname = "/anthropic";
      return url.toString().replace(/\/$/, "");
    }
    if (
      (api === "openai-completions" || api === "openai-responses") &&
      path === "/anthropic"
    ) {
      url.pathname = "/";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // 表单保存时由共享 Zod schema 校验 URL。
  }
  return provider.baseUrl;
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      {description && (
        <span className="-mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </span>
      )}
      {children}
    </label>
  );
}

function ToggleField({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-start gap-2 rounded-lg border p-2.5">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium">{label}</span>
        {description && (
          <span className="block text-[11px] text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min = 0,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  return (
    <Input
      type="number"
      min={min}
      value={value}
      className="h-8"
      onChange={(event) => onChange(Number(event.target.value) || 0)}
    />
  );
}

function ProviderPane({
  config,
  setConfig,
  onSave,
}: {
  config: AiConfigV1;
  setConfig: (config: AiConfigV1) => void;
  onSave: (nextConfig?: AiConfigV1) => Promise<void>;
}) {
  const snapshot = useAiConfigStore((state) => state.snapshot);
  const saveProvider = useAiConfigStore((state) => state.saveProvider);
  const deleteCredential = useAiConfigStore((state) => state.deleteCredential);
  const discover = useAiConfigStore((state) => state.discover);
  const testProvider = useAiConfigStore((state) => state.testProvider);
  const [selectedId, setSelectedId] = useState(config.providers[0]?.id ?? "");
  const [credentials, setCredentials] = useState<
    Record<string, AiCredentialDraft>
  >({});
  const [busy, setBusy] = useState<"save" | "test" | "discover" | null>(null);
  const [newPlainName, setNewPlainName] = useState("");
  const [newPlainValue, setNewPlainValue] = useState("");
  const [newSecretName, setNewSecretName] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");
  const provider =
    config.providers.find((entry) => entry.id === selectedId) ??
    config.providers[0];

  useEffect(() => {
    if (!provider && config.providers[0]) setSelectedId(config.providers[0].id);
  }, [config.providers, provider]);

  const updateProvider = (patch: Partial<AiProviderConfig>) => {
    if (!provider) return;
    setConfig({
      ...config,
      providers: config.providers.map((entry) =>
        entry.id === provider.id ? { ...entry, ...patch } : entry
      ),
    });
  };

  const credential = provider ? (credentials[provider.id] ?? {}) : {};
  const setCredential = (patch: Partial<AiCredentialDraft>) => {
    if (!provider) return;
    setCredentials((current) => ({
      ...current,
      [provider.id]: { ...(current[provider.id] ?? {}), ...patch },
    }));
  };

  const discoveredForProvider = useMemo(
    () =>
      provider
        ? config.models.filter((model) => model.providerId === provider.id)
        : [],
    [config.models, provider]
  );

  const save = async () => {
    if (!provider) return;
    setBusy("save");
    try {
      await saveProvider(config, provider, credential);
      setCredentials((current) => ({ ...current, [provider.id]: {} }));
      toast.success("Provider 配置已保存");
    } catch (error) {
      toast.error("保存失败", { description: String(error) });
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    if (!provider) return;
    setBusy("test");
    try {
      const modelId = config.models.find(
        (model) => model.providerId === provider.id && model.enabled
      )?.modelId;
      const result = await testProvider(provider, credential, modelId);
      toast.success(result.message);
    } catch (error) {
      toast.error("连接测试失败", { description: String(error) });
    } finally {
      setBusy(null);
    }
  };

  const runDiscovery = async () => {
    if (!provider) return;
    setBusy("discover");
    try {
      const models = await discover(provider, credential);
      const found = new Set(models.map((model) => model.modelId));
      setConfig({
        ...config,
        models: config.models.map((model) =>
          model.providerId === provider.id
            ? {
                ...model,
                remoteStatus: found.has(model.modelId) ? "found" : "missing",
              }
            : model
        ),
      });
      toast.success(`发现 ${models.length} 个模型`, {
        description: "候选模型不会自动启用，请到“已启用模型”确认元数据。",
      });
    } catch (error) {
      toast.error("拉取模型失败", {
        description: `${String(error)}；仍可手工添加模型。`,
      });
    } finally {
      setBusy(null);
    }
  };

  const addProvider = () => {
    const next = createProvider("openai");
    setConfig({ ...config, providers: [...config.providers, next] });
    setSelectedId(next.id);
  };

  const copyProvider = () => {
    if (!provider) return;
    const next = {
      ...structuredClone(provider),
      id: crypto.randomUUID(),
      name: `${provider.name} 副本`,
    };
    setConfig({ ...config, providers: [...config.providers, next] });
    setSelectedId(next.id);
  };

  const removeProvider = () => {
    if (!provider) return;
    const references = collectAiConfigReferences(config, {
      type: "provider",
      id: provider.id,
    });
    if (references.length) {
      toast.error("无法删除 Provider", {
        description: `请先移除以下引用：${references.join("、")}`,
      });
      return;
    }
    const next = {
      ...config,
      providers: config.providers.filter((entry) => entry.id !== provider.id),
    };
    setConfig(next);
    setSelectedId("");
    void onSave(next)
      .then(() => toast.success("Provider 已删除"))
      .catch((error) =>
        toast.error("删除 Provider 失败", { description: String(error) })
      );
  };

  return (
    <div className="grid min-h-[480px] grid-cols-[180px_minmax(0,1fr)] gap-4">
      <aside className="space-y-2 border-r pr-3">
        <Button className="w-full" size="sm" onClick={addProvider}>
          <Plus data-icon="inline-start" />
          添加 Provider
        </Button>
        <div className="space-y-1">
          {config.providers.map((entry) => {
            const status = snapshot?.authStatus.find(
              (item) => item.providerId === entry.id
            );
            return (
              <button
                type="button"
                key={entry.id}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs",
                  entry.id === provider?.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/60"
                )}
                onClick={() => setSelectedId(entry.id)}
              >
                <Server className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {status?.configured ? (
                  <CheckCircle2 className="size-3.5 text-status-done" />
                ) : (
                  <AlertCircle className="size-3.5 text-muted-foreground" />
                )}
              </button>
            );
          })}
        </div>
      </aside>

      {!provider ? (
        <div className="flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <Server className="size-8" />
          尚未添加 Provider
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">{provider.name}</h3>
              <p className="font-mono text-[10px] text-muted-foreground">
                mailuo-{provider.id}
              </p>
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="icon-sm" onClick={copyProvider}>
                <Copy />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                className="text-destructive"
                onClick={removeProvider}
              >
                <Trash2 />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ToggleField
              checked={provider.enabled}
              label="启用 Provider"
              description="停用后，其模型和路由不会进入运行时。"
              onChange={(enabled) => updateProvider({ enabled })}
            />
            <ToggleField
              checked={provider.authHeader}
              label="发送 Authorization Header"
              description="Bearer API Key 模式通常需要开启。"
              onChange={(authHeader) => updateProvider({ authHeader })}
            />
            <Field label="名称">
              <Input
                value={provider.name}
                className="h-8"
                onChange={(event) => updateProvider({ name: event.target.value })}
              />
            </Field>
            <Field label="预设">
              <Select
                value={provider.preset}
                onValueChange={(value) => {
                  const preset = value as AiProviderPreset;
                  const defaults = PRESETS[preset];
                  updateProvider({
                    preset,
                    name: defaults.label,
                    baseUrl: defaults.baseUrl,
                    api: defaults.api,
                    authMode: defaults.authMode,
                    authHeader: defaults.authMode === "api-key",
                    discovery: { adapter: defaults.discovery },
                  });
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {AI_PROVIDER_PRESETS.map((preset) => (
                      <SelectItem key={preset} value={preset}>
                        {PRESETS[preset].label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Base URL">
              <Input
                value={provider.baseUrl}
                className="h-8"
                onChange={(event) =>
                  updateProvider({ baseUrl: event.target.value })
                }
              />
            </Field>
            <Field label="消息协议">
              <Select
                value={provider.api}
                onValueChange={(value) => {
                  const api = value as AiApiType;
                  updateProvider({
                    api,
                    baseUrl: baseUrlForProtocol(provider, api),
                  });
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_API_TYPES.map((api) => (
                    <SelectItem key={api} value={api}>
                      {api}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="认证模式">
              <Select
                value={provider.authMode}
                onValueChange={(value) =>
                  updateProvider({
                    authMode: value as AiAuthMode,
                    authHeader: value === "api-key",
                  })
                }
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api-key">Bearer API Key</SelectItem>
                  <SelectItem value="none">免密</SelectItem>
                  <SelectItem value="custom-headers">
                    自定义敏感 Header
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="发现适配器">
              <Select
                value={provider.discovery.adapter}
                onValueChange={(value) =>
                  updateProvider({
                    discovery: {
                      ...provider.discovery,
                      adapter: value as AiDiscoveryAdapter,
                    },
                  })
                }
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["openai", "anthropic", "gemini", "ollama", "manual"].map(
                    (adapter) => (
                      <SelectItem key={adapter} value={adapter}>
                        {adapter}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            label="模型发现 URL 覆盖"
            description="留空时按适配器和 Base URL 自动计算。"
          >
            <Input
              value={provider.discovery.url ?? ""}
              placeholder="留空使用默认地址"
              className="h-8"
              onChange={(event) =>
                updateProvider({
                  discovery: {
                    ...provider.discovery,
                    url: event.target.value,
                  },
                })
              }
            />
          </Field>

          {provider.authMode === "api-key" && (
            <Field
              label="API Key"
              description={
                snapshot?.authStatus.find(
                  (status) => status.providerId === provider.id
                )?.apiKeyMask
                  ? `已保存：${
                      snapshot.authStatus.find(
                        (status) => status.providerId === provider.id
                      )?.apiKeyMask
                    }；留空保持不变。`
                  : "只写入 ~/.mailuo/ai/auth.json，不会回传完整值。"
              }
            >
              <Input
                type="password"
                value={credential.apiKey ?? ""}
                placeholder="输入新的 API Key"
                className="h-8"
                onChange={(event) =>
                  setCredential({ apiKey: event.target.value })
                }
              />
            </Field>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium">普通 Headers</p>
            {Object.entries(provider.headers).map(([name, value]) => (
              <div key={name} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  value={name}
                  className="h-8"
                  onChange={(event) => {
                    const headers = { ...provider.headers };
                    delete headers[name];
                    headers[event.target.value] = value;
                    updateProvider({ headers });
                  }}
                />
                <Input
                  value={value}
                  className="h-8"
                  onChange={(event) =>
                    updateProvider({
                      headers: {
                        ...provider.headers,
                        [name]: event.target.value,
                      },
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    const headers = { ...provider.headers };
                    delete headers[name];
                    updateProvider({ headers });
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input
                value={newPlainName}
                placeholder="Header 名称"
                className="h-8"
                onChange={(event) => setNewPlainName(event.target.value)}
              />
              <Input
                value={newPlainValue}
                placeholder="普通值"
                className="h-8"
                onChange={(event) => setNewPlainValue(event.target.value)}
              />
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => {
                  if (!newPlainName.trim()) return;
                  updateProvider({
                    headers: {
                      ...provider.headers,
                      [newPlainName.trim()]: newPlainValue,
                    },
                  });
                  setNewPlainName("");
                  setNewPlainValue("");
                }}
              >
                <Plus />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <KeyRound className="size-3.5" />
              敏感 Headers
            </p>
            {provider.secretHeaderNames.map((name) => {
              const status = snapshot?.authStatus
                .find((entry) => entry.providerId === provider.id)
                ?.secretHeaders.find((entry) => entry.name === name);
              return (
                <div key={name} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input value={name} className="h-8" readOnly />
                  <Input
                    type="password"
                    value={credential.secretHeaders?.[name] ?? ""}
                    placeholder={status?.configured ? "已保存，留空保持" : "敏感值"}
                    className="h-8"
                    onChange={(event) =>
                      setCredential({
                        secretHeaders: {
                          ...(credential.secretHeaders ?? {}),
                          [name]: event.target.value,
                        },
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      updateProvider({
                        secretHeaderNames: provider.secretHeaderNames.filter(
                          (entry) => entry !== name
                        ),
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input
                value={newSecretName}
                placeholder="Header 名称"
                className="h-8"
                onChange={(event) => setNewSecretName(event.target.value)}
              />
              <Input
                type="password"
                value={newSecretValue}
                placeholder="敏感值"
                className="h-8"
                onChange={(event) => setNewSecretValue(event.target.value)}
              />
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => {
                  const name = newSecretName.trim();
                  if (!name) return;
                  updateProvider({
                    secretHeaderNames: [
                      ...new Set([...provider.secretHeaderNames, name]),
                    ],
                  });
                  setCredential({
                    secretHeaders: {
                      ...(credential.secretHeaders ?? {}),
                      [name]: newSecretValue,
                    },
                  });
                  setNewSecretName("");
                  setNewSecretValue("");
                }}
              >
                <Plus />
              </Button>
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="mb-2 text-xs font-medium">协议兼容设置</p>
            {usesDeepSeekWebSearch(provider) && (
              <p className="mb-2 rounded-md bg-accent/60 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
                DeepSeek Responses 会自动向小枢会话接入服务端 web_search；
                搜索由 DeepSeek 执行，不需要额外配置搜索服务。
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {provider.api === "anthropic-messages" ? (
                <>
                  <ToggleField
                    checked={
                      provider.compat?.anthropic
                        ?.supportsCacheControlOnTools ?? false
                    }
                    label="Tool cache control"
                    onChange={(value) =>
                      updateProvider({
                        compat: {
                          ...provider.compat,
                          anthropic: {
                            ...provider.compat?.anthropic,
                            supportsCacheControlOnTools: value,
                          },
                        },
                      })
                    }
                  />
                  <ToggleField
                    checked={
                      provider.compat?.anthropic?.forceAdaptiveThinking ?? false
                    }
                    label="强制 Adaptive thinking"
                    onChange={(value) =>
                      updateProvider({
                        compat: {
                          ...provider.compat,
                          anthropic: {
                            ...provider.compat?.anthropic,
                            forceAdaptiveThinking: value,
                          },
                        },
                      })
                    }
                  />
                </>
              ) : provider.api === "openai-responses" ? (
                <>
                  <ToggleField
                    checked={
                      provider.compat?.openaiResponses
                        ?.supportsDeveloperRole ?? false
                    }
                    label="Developer role"
                    onChange={(value) =>
                      updateProvider({
                        compat: {
                          ...provider.compat,
                          openaiResponses: {
                            ...provider.compat?.openaiResponses,
                            supportsDeveloperRole: value,
                          },
                        },
                      })
                    }
                  />
                  <ToggleField
                    checked={
                      provider.compat?.openaiResponses?.supportsStrictMode ??
                      false
                    }
                    label="Strict tools"
                    onChange={(value) =>
                      updateProvider({
                        compat: {
                          ...provider.compat,
                          openaiResponses: {
                            ...provider.compat?.openaiResponses,
                            supportsStrictMode: value,
                          },
                        },
                      })
                    }
                  />
                  <ToggleField
                    checked={
                      provider.compat?.openaiResponses
                        ?.supportsExplicitPromptCacheMode ?? false
                    }
                    label="Explicit prompt cache"
                    onChange={(value) =>
                      updateProvider({
                        compat: {
                          ...provider.compat,
                          openaiResponses: {
                            ...provider.compat?.openaiResponses,
                            supportsExplicitPromptCacheMode: value,
                          },
                        },
                      })
                    }
                  />
                </>
              ) : provider.api === "openai-completions" ? (
                <>
                  <ToggleField
                    checked={
                      provider.compat?.openaiCompletions
                        ?.supportsDeveloperRole ?? false
                    }
                    label="Developer role"
                    onChange={(value) =>
                      updateProvider({
                        compat: {
                          ...provider.compat,
                          openaiCompletions: {
                            ...provider.compat?.openaiCompletions,
                            supportsDeveloperRole: value,
                          },
                        },
                      })
                    }
                  />
                  <ToggleField
                    checked={
                      provider.compat?.openaiCompletions
                        ?.supportsReasoningEffort ?? false
                    }
                    label="Reasoning effort"
                    onChange={(value) =>
                      updateProvider({
                        compat: {
                          ...provider.compat,
                          openaiCompletions: {
                            ...provider.compat?.openaiCompletions,
                            supportsReasoningEffort: value,
                          },
                        },
                      })
                    }
                  />
                  <ToggleField
                    checked={
                      provider.compat?.openaiCompletions
                        ?.requiresToolResultName ?? false
                    }
                    label="Tool result name"
                    onChange={(value) =>
                      updateProvider({
                        compat: {
                          ...provider.compat,
                          openaiCompletions: {
                            ...provider.compat?.openaiCompletions,
                            requiresToolResultName: value,
                          },
                        },
                      })
                    }
                  />
                  <Field label="最大输出字段">
                    <Select
                      value={
                        provider.compat?.openaiCompletions?.maxTokensField ??
                        "max_completion_tokens"
                      }
                      onValueChange={(value) =>
                        updateProvider({
                          compat: {
                            ...provider.compat,
                            openaiCompletions: {
                              ...provider.compat?.openaiCompletions,
                              maxTokensField: value as
                                | "max_tokens"
                                | "max_completion_tokens",
                            },
                          },
                        })
                      }
                    >
                      <SelectTrigger size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="max_completion_tokens">
                          max_completion_tokens
                        </SelectItem>
                        <SelectItem value="max_tokens">max_tokens</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </>
              ) : (
                <p className="col-span-2 text-xs text-muted-foreground">
                  当前协议没有 pi compat 覆盖字段。
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button onClick={() => void save()} disabled={busy !== null}>
              {busy === "save" ? <Spinner /> : <Save />}
              保存 Provider
            </Button>
            <Button
              variant="outline"
              onClick={() => void runTest()}
              disabled={busy !== null}
            >
              {busy === "test" ? <Spinner /> : <CheckCircle2 />}
              测试连接
            </Button>
            <Button
              variant="outline"
              onClick={() => void runDiscovery()}
              disabled={
                busy !== null || provider.discovery.adapter === "manual"
              }
            >
              {busy === "discover" ? <Spinner /> : <RefreshCw />}
              拉取模型
            </Button>
            {provider.authMode !== "none" && (
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() =>
                  void deleteCredential(provider.id)
                    .then(() => toast.success("已清除 Provider 凭据"))
                    .catch((error) =>
                      toast.error("清除凭据失败", {
                        description: String(error),
                      })
                    )
                }
              >
                <KeyRound />
                清除凭据
              </Button>
            )}
            <span className="text-[11px] text-muted-foreground">
              当前模型库 {discoveredForProvider.length} 个
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function modelFromDiscovery(
  providerId: string,
  model: DiscoveredModel
): AiModelConfig {
  return {
    providerId,
    modelId: model.modelId,
    name: model.name,
    enabled: true,
    input: model.input,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    metadataSource: model.metadataSource,
    remoteStatus: "found",
  };
}

function ModelsPane({
  config,
  setConfig,
  onSave,
}: {
  config: AiConfigV1;
  setConfig: (config: AiConfigV1) => void;
  onSave: (nextConfig?: AiConfigV1) => Promise<void>;
}) {
  const [providerId, setProviderId] = useState(config.providers[0]?.id ?? "");
  const discoveries = useAiConfigStore((state) => state.discoveries);
  const lastDiscoveredProviderId = useAiConfigStore(
    (state) => state.lastDiscoveredProviderId
  );
  const [manualId, setManualId] = useState("");
  const [manualName, setManualName] = useState("");

  useEffect(() => {
    if (lastDiscoveredProviderId) setProviderId(lastDiscoveredProviderId);
  }, [lastDiscoveredProviderId]);
  const candidates = discoveries[providerId] ?? [];

  const models = config.models.filter(
    (model) => !providerId || model.providerId === providerId
  );
  const updateModel = (
    target: AiModelConfig,
    patch: Partial<AiModelConfig>
  ) => {
    const nextModelId = patch.modelId?.trim();
    if (
      nextModelId &&
      nextModelId !== target.modelId &&
      config.models.some(
        (model) =>
          model.providerId === target.providerId &&
          model.modelId === nextModelId
      )
    ) {
      toast.error("模型 ID 已存在");
      return;
    }
    const changingId = Boolean(nextModelId && nextModelId !== target.modelId);
    setConfig({
      ...config,
      models: config.models.map((model) =>
        modelRefKey(model) === modelRefKey(target)
          ? { ...model, ...patch, ...(nextModelId ? { modelId: nextModelId } : {}) }
          : model
      ),
      routes: changingId
        ? Object.fromEntries(
            Object.entries(config.routes).map(([useCase, route]) => [
              useCase,
              route.model &&
              route.model.providerId === target.providerId &&
              route.model.modelId === target.modelId
                ? {
                    ...route,
                    model: { ...route.model, modelId: nextModelId! },
                  }
                : route,
            ])
          ) as AiConfigV1["routes"]
        : config.routes,
    });
  };
  const removeModel = (target: AiModelConfig) => {
    const refs = collectAiConfigReferences(config, {
      type: "model",
      ref: target,
    });
    if (refs.length) {
      toast.error("无法删除模型", {
        description: `请先移除以下引用：${refs.join("、")}`,
      });
      return;
    }
    setConfig({
      ...config,
      models: config.models.filter(
        (model) => modelRefKey(model) !== modelRefKey(target)
      ),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-2">
        <Field label="Provider">
          <Select value={providerId} onValueChange={setProviderId}>
            <SelectTrigger size="sm" className="w-56">
              <SelectValue placeholder="选择 Provider" />
            </SelectTrigger>
            <SelectContent>
              {config.providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button
          onClick={() =>
            void onSave()
              .then(() => toast.success("模型库已保存"))
              .catch((error) =>
                toast.error("保存失败", { description: String(error) })
              )
          }
        >
          <Save />
          保存模型库
        </Button>
      </div>

      {candidates.length > 0 && (
        <div className="rounded-lg border p-3">
          <h3 className="mb-1 text-sm font-medium">远端候选</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            只有点击“启用”后才会进入配置；推断值请确认后再保存。
          </p>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {candidates.map((candidate) => {
              const exists = config.models.some(
                (model) =>
                  model.providerId === providerId &&
                  model.modelId === candidate.modelId
              );
              return (
                <div
                  key={candidate.modelId}
                  className="grid grid-cols-[minmax(0,1fr)_100px_90px_auto] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">
                      {candidate.name}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {candidate.modelId}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {candidate.contextWindow.toLocaleString()} ctx
                  </span>
                  <Badge
                    variant={
                      candidate.metadataSource === "inferred"
                        ? "outline"
                        : "secondary"
                    }
                  >
                    {candidate.metadataSource === "inferred"
                      ? "推断值"
                      : "远端元数据"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={exists}
                    onClick={() =>
                      setConfig({
                        ...config,
                        models: [
                          ...config.models,
                          modelFromDiscovery(providerId, candidate),
                        ],
                      })
                    }
                  >
                    {exists ? "已添加" : "启用"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg border p-3">
        <h3 className="mb-2 text-sm font-medium">手工添加</h3>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Input
            value={manualId}
            placeholder="模型 ID"
            className="h-8"
            onChange={(event) => setManualId(event.target.value)}
          />
          <Input
            value={manualName}
            placeholder="显示名"
            className="h-8"
            onChange={(event) => setManualName(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!providerId || !manualId.trim()}
            onClick={() => {
              const model = modelFromDiscovery(providerId, {
                modelId: manualId.trim(),
                name: manualName.trim() || manualId.trim(),
                input: ["text"],
                reasoning: false,
                contextWindow: 128_000,
                maxTokens: 16_384,
                metadataSource: "inferred",
              });
              model.metadataSource = "manual";
              model.remoteStatus = "unknown";
              setConfig({ ...config, models: [...config.models, model] });
              setManualId("");
              setManualName("");
            }}
          >
            <Plus />
            添加
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">模型库</h3>
        {models.length === 0 && (
          <p className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">
            还没有模型。请先在 Provider 中拉取候选，或手工添加。
          </p>
        )}
        {models.map((model) => (
          <div key={modelRefKey(model)} className="rounded-lg border p-3">
            <div className="mb-3 flex items-center gap-2">
              <Checkbox
                checked={model.enabled}
                onCheckedChange={(value) =>
                  updateModel(model, { enabled: value === true })
                }
              />
              <Input
                value={model.name}
                className="h-8 min-w-0 flex-1"
                onChange={(event) =>
                  updateModel(model, { name: event.target.value })
                }
              />
              {model.remoteStatus === "missing" && (
                <Badge variant="destructive">未发现</Badge>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => removeModel(model)}
              >
                <Trash2 />
              </Button>
            </div>
            <Field label="Model ID（实际发送给服务商，可按项目兼容需要修改）">
              <Input
                key={model.modelId}
                defaultValue={model.modelId}
                className="mb-2 h-8 font-mono text-xs"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (!value) {
                    toast.error("Model ID 不能为空");
                    event.target.value = model.modelId;
                    return;
                  }
                  if (
                    value !== model.modelId &&
                    config.models.some(
                      (entry) =>
                        entry.providerId === model.providerId &&
                        entry.modelId === value
                    )
                  ) {
                    toast.error("模型 ID 已存在");
                    event.target.value = model.modelId;
                    return;
                  }
                  updateModel(model, { modelId: value });
                }}
                onKeyDown={(event) => {
                  if (isSubmitKey(event, { allowShift: true }))
                    event.currentTarget.blur();
                }}
              />
            </Field>
            <div className="grid grid-cols-4 gap-2">
              <Field label="上下文窗口">
                <NumberInput
                  value={model.contextWindow}
                  min={1}
                  onChange={(contextWindow) =>
                    updateModel(model, { contextWindow })
                  }
                />
              </Field>
              <Field label="最大输出">
                <NumberInput
                  value={model.maxTokens}
                  min={1}
                  onChange={(maxTokens) => updateModel(model, { maxTokens })}
                />
              </Field>
              <ToggleField
                checked={model.reasoning}
                label="推理模型"
                onChange={(reasoning) => updateModel(model, { reasoning })}
              />
              <ToggleField
                checked={model.input.includes("image")}
                label="图片输入"
                onChange={(enabled) =>
                  updateModel(model, {
                    input: enabled ? ["text", "image"] : ["text"],
                  })
                }
              />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 border-t pt-3">
              {(
                [
                  ["input", "输入成本"],
                  ["output", "输出成本"],
                  ["cacheRead", "缓存读取"],
                  ["cacheWrite", "缓存写入"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={`${label} / 百万 tokens`}>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={model.cost[key]}
                    className="h-8"
                    onChange={(event) =>
                      updateModel(model, {
                        cost: {
                          ...model.cost,
                          [key]: Number(event.target.value) || 0,
                        },
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            {model.reasoning && (
              <div className="mt-3 border-t pt-3">
                <p className="mb-2 text-xs font-medium">
                  Thinking level 映射
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {(["minimal", "low", "medium", "high"] as const).map(
                    (level) => (
                      <Field key={level} label={level}>
                        <Input
                          value={model.thinkingLevelMap?.[level] ?? ""}
                          placeholder="协议默认"
                          className="h-8"
                          onChange={(event) => {
                            const thinkingLevelMap = {
                              ...(model.thinkingLevelMap ?? {}),
                            };
                            if (event.target.value) {
                              thinkingLevelMap[level] = event.target.value;
                            } else {
                              delete thinkingLevelMap[level];
                            }
                            updateModel(model, {
                              thinkingLevelMap:
                                Object.keys(thinkingLevelMap).length > 0
                                  ? thinkingLevelMap
                                  : undefined,
                            });
                          }}
                        />
                      </Field>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoutesPane({
  config,
  setConfig,
  onSave,
}: {
  config: AiConfigV1;
  setConfig: (config: AiConfigV1) => void;
  onSave: (nextConfig?: AiConfigV1) => Promise<void>;
}) {
  const enabledModels = config.models.filter(
    (model) =>
      model.enabled &&
      config.providers.some(
        (provider) => provider.id === model.providerId && provider.enabled
      )
  );
  const updateRoute = (
    useCase: AiUseCase,
    patch: Partial<(typeof config.routes)[AiUseCase]>
  ) =>
    setConfig({
      ...config,
      routes: {
        ...config.routes,
        [useCase]: { ...config.routes[useCase], ...patch },
      },
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">用途路由</h3>
          <p className="text-xs text-muted-foreground">
            一次性 AI 操作只使用这里的路由，不提供临时模型选择。
          </p>
        </div>
        <Button
          onClick={() =>
            void onSave()
              .then(() => toast.success("用途路由已保存"))
              .catch((error) =>
                toast.error("保存失败", { description: String(error) })
              )
          }
        >
          <Save />
          保存路由
        </Button>
      </div>
      {AI_USE_CASES.map((useCase) => {
        const route = config.routes[useCase];
        const selected = route.model ? modelRefKey(route.model) : "none";
        return (
          <div
            key={useCase}
            className="grid grid-cols-[130px_minmax(0,1fr)_130px_150px] items-end gap-3 rounded-lg border p-3"
          >
            <span className="pb-2 text-xs font-medium">
              {USE_CASE_LABELS[useCase]}
            </span>
            <Field label="模型">
              <Select
                value={selected}
                onValueChange={(value) => {
                  const model = enabledModels.find(
                    (entry) => modelRefKey(entry) === value
                  );
                  updateRoute(useCase, {
                    model: model
                      ? {
                          providerId: model.providerId,
                          modelId: model.modelId,
                        }
                      : null,
                  });
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未配置</SelectItem>
                  {enabledModels.map((model) => (
                    <SelectItem
                      key={modelRefKey(model)}
                      value={modelRefKey(model)}
                    >
                      {config.providers.find((provider) => provider.id === model.providerId)?.name ?? model.providerId} / {model.name}
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">{model.modelId}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="思考强度">
              <Select
                value={route.thinkingLevel}
                onValueChange={(value) =>
                  updateRoute(useCase, {
                    thinkingLevel: value as AiThinkingLevel,
                  })
                }
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_THINKING_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="上下文配置档">
              <Select
                value={route.contextProfileId}
                onValueChange={(contextProfileId) =>
                  updateRoute(useCase, { contextProfileId })
                }
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config.contextProfiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        );
      })}
    </div>
  );
}

function ContextPane({
  config,
  setConfig,
  onSave,
}: {
  config: AiConfigV1;
  setConfig: (config: AiConfigV1) => void;
  onSave: (nextConfig?: AiConfigV1) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(config.contextProfiles[0]?.id ?? "");
  const profile =
    config.contextProfiles.find((entry) => entry.id === selectedId) ??
    config.contextProfiles[0];
  const update = (next: AiContextProfile) =>
    setConfig({
      ...config,
      contextProfiles: config.contextProfiles.map((entry) =>
        entry.id === next.id ? next : entry
      ),
    });
  const duplicate = () => {
    if (!profile) return;
    const next = {
      ...structuredClone(profile),
      id: crypto.randomUUID(),
      name: `${profile.name} 副本`,
    };
    setConfig({
      ...config,
      contextProfiles: [...config.contextProfiles, next],
    });
    setSelectedId(next.id);
  };
  const remove = () => {
    if (!profile) return;
    const refs = collectAiConfigReferences(config, {
      type: "context",
      id: profile.id,
    });
    if (refs.length) {
      toast.error("无法删除上下文配置档", {
        description: `请先移除以下引用：${refs.join("、")}`,
      });
      return;
    }
    setConfig({
      ...config,
      contextProfiles: config.contextProfiles.filter(
        (entry) => entry.id !== profile.id
      ),
    });
    setSelectedId(config.contextProfiles.find((entry) => entry.id !== profile.id)?.id ?? "");
  };

  if (!profile) return null;
  const updateSource = (
    key: keyof Omit<AiContextProfile["sources"], "attachments">,
    patch: Partial<{ enabled: boolean; maxChars: number }>
  ) =>
    update({
      ...profile,
      sources: {
        ...profile.sources,
        [key]: { ...profile.sources[key], ...patch },
      },
    });

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-2">
        <Field label="配置档">
          <Select value={profile.id} onValueChange={setSelectedId}>
            <SelectTrigger size="sm" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.contextProfiles.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button variant="outline" size="sm" onClick={duplicate}>
          <Copy />
          复制
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          className="text-destructive"
          onClick={remove}
        >
          <Trash2 />
        </Button>
        <Button
          className="ml-auto"
          onClick={() =>
            void onSave()
              .then(() => toast.success("上下文配置档已保存"))
              .catch((error) =>
                toast.error("保存失败", { description: String(error) })
              )
          }
        >
          <Save />
          保存配置档
        </Button>
      </div>

      <Field label="名称">
        <Input
          value={profile.name}
          className="h-8"
          onChange={(event) => update({ ...profile, name: event.target.value })}
        />
      </Field>
      <Field
        label="追加 System 指令"
        description="只会追加到应用内置业务协议之后，不能覆盖结构化输出协议。"
      >
        <Textarea
          value={profile.appendSystemPrompt}
          placeholder="领域术语、语言或语气要求"
          onChange={(event) =>
            update({ ...profile, appendSystemPrompt: event.target.value })
          }
        />
      </Field>

      <div>
        <h3 className="mb-2 text-sm font-medium">上下文来源与字符上限</h3>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["projectSnapshot", "项目快照"],
              ["taskDetails", "任务详情"],
              ["longTermMemory", "长期记忆"],
              ["conversationHistory", "历史摘录"],
              ["skills", "Skills"],
            ] as const
          ).map(([key, label]) => (
            <div
              key={key}
              className="grid grid-cols-[auto_1fr_100px] items-center gap-2 rounded-lg border p-2.5"
            >
              <Checkbox
                checked={profile.sources[key].enabled}
                onCheckedChange={(value) =>
                  updateSource(key, { enabled: value === true })
                }
              />
              <span className="text-xs">{label}</span>
              <NumberInput
                value={profile.sources[key].maxChars}
                onChange={(maxChars) => updateSource(key, { maxChars })}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border p-3">
        <div className="mb-3 flex items-center gap-2">
          <Checkbox
            checked={profile.sources.attachments.enabled}
            onCheckedChange={(value) =>
              update({
                ...profile,
                sources: {
                  ...profile.sources,
                  attachments: {
                    ...profile.sources.attachments,
                    enabled: value === true,
                  },
                },
              })
            }
          />
          <span className="text-xs font-medium">附件预算</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="最大数量">
            <NumberInput
              value={profile.sources.attachments.maxCount}
              onChange={(maxCount) =>
                update({
                  ...profile,
                  sources: {
                    ...profile.sources,
                    attachments: {
                      ...profile.sources.attachments,
                      maxCount,
                    },
                  },
                })
              }
            />
          </Field>
          <Field label="总字节数">
            <NumberInput
              value={profile.sources.attachments.maxBytes}
              onChange={(maxBytes) =>
                update({
                  ...profile,
                  sources: {
                    ...profile.sources,
                    attachments: {
                      ...profile.sources.attachments,
                      maxBytes,
                    },
                  },
                })
              }
            />
          </Field>
          <Field label="文本字符数">
            <NumberInput
              value={profile.sources.attachments.maxTextChars}
              onChange={(maxTextChars) =>
                update({
                  ...profile,
                  sources: {
                    ...profile.sources,
                    attachments: {
                      ...profile.sources.attachments,
                      maxTextChars,
                    },
                  },
                })
              }
            />
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border p-3">
          <ToggleField
            checked={profile.compaction.enabled}
            label="自动压缩上下文"
            onChange={(enabled) =>
              update({
                ...profile,
                compaction: { ...profile.compaction, enabled },
              })
            }
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="预留 tokens">
              <NumberInput
                value={profile.compaction.reserveTokens}
                onChange={(reserveTokens) =>
                  update({
                    ...profile,
                    compaction: { ...profile.compaction, reserveTokens },
                  })
                }
              />
            </Field>
            <Field label="保留近期 tokens">
              <NumberInput
                value={profile.compaction.keepRecentTokens}
                onChange={(keepRecentTokens) =>
                  update({
                    ...profile,
                    compaction: { ...profile.compaction, keepRecentTokens },
                  })
                }
              />
            </Field>
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <ToggleField
            checked={profile.retry.enabled}
            label="自动重试"
            onChange={(enabled) =>
              update({ ...profile, retry: { ...profile.retry, enabled } })
            }
          />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="尝试次数">
              <NumberInput
                value={profile.retry.maxAttempts}
                onChange={(maxAttempts) =>
                  update({ ...profile, retry: { ...profile.retry, maxAttempts } })
                }
              />
            </Field>
            <Field label="基础延迟 ms">
              <NumberInput
                value={profile.retry.baseDelayMs}
                onChange={(baseDelayMs) =>
                  update({ ...profile, retry: { ...profile.retry, baseDelayMs } })
                }
              />
            </Field>
            <Field label="最大延迟 ms">
              <NumberInput
                value={profile.retry.maxDelayMs}
                onChange={(maxDelayMs) =>
                  update({ ...profile, retry: { ...profile.retry, maxDelayMs } })
                }
              />
            </Field>
          </div>
        </div>
      </div>
    </div>
  );
}

function NetworkPane({
  config,
  setConfig,
  onSave,
}: {
  config: AiConfigV1;
  setConfig: (config: AiConfigV1) => void;
  onSave: (nextConfig?: AiConfigV1) => Promise<void>;
}) {
  const update = (patch: Partial<AiConfigV1["network"]>) =>
    setConfig({ ...config, network: { ...config.network, ...patch } });
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">应用级网络代理</h3>
        <p className="text-xs text-muted-foreground">
          代理作用于整个 AI 运行时；不提供逐 Provider 代理。
        </p>
      </div>
      <Field label="HTTP proxy">
        <Input
          value={config.network.httpProxy}
          placeholder="http://127.0.0.1:7890"
          onChange={(event) => update({ httpProxy: event.target.value })}
        />
      </Field>
      <Field label="HTTPS proxy">
        <Input
          value={config.network.httpsProxy}
          placeholder="http://127.0.0.1:7890"
          onChange={(event) => update({ httpsProxy: event.target.value })}
        />
      </Field>
      <Field label="NO_PROXY">
        <Input
          value={config.network.noProxy}
          placeholder="localhost,127.0.0.1"
          onChange={(event) => update({ noProxy: event.target.value })}
        />
      </Field>
      <Button
        onClick={() =>
          void onSave()
            .then(() => toast.success("网络配置已保存"))
            .catch((error) =>
              toast.error("保存失败", { description: String(error) })
            )
        }
      >
        <Save />
        保存网络配置
      </Button>
    </div>
  );
}

const PROMPT_KIND_LABEL: Record<PromptKind, string> = {
  "project-plan": "项目规划",
  "task-breakdown": "任务拆解",
  "dependency-suggest": "依赖建议",
  "notes-polish": "备注润色",
};

function PromptTemplatesPane() {
  const [items, setItems] = useState<PromptTemplate[]>(loadPromptTemplates);
  const [query, setQuery] = useState("");
  const persist = (next: PromptTemplate[]) => {
    setItems(next);
    savePromptTemplates(next);
  };
  const add = () => persist([...items, {
    id: crypto.randomUUID(),
    name: "新模板",
    kind: "notes-polish",
    prompt: "",
    tags: [],
    isDefault: false,
    updatedAt: Date.now(),
  }]);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={query} placeholder="搜索名称、标签或提示词…" onChange={(event) => setQuery(event.target.value)} />
        <Button onClick={add}><Plus />新建模板</Button>
      </div>
      {items.filter((item) => `${item.name} ${item.tags.join(" ")} ${item.prompt}`.toLowerCase().includes(query.toLowerCase())).map((item) => (
        <div key={item.id} className="rounded-lg border p-3">
          <div className="mb-2 grid grid-cols-[1fr_150px_auto_auto] gap-2">
            <Input value={item.name} onChange={(event) => persist(items.map((entry) => entry.id === item.id ? { ...entry, name: event.target.value, updatedAt: Date.now() } : entry))} />
            <Select value={item.kind} onValueChange={(kind) => persist(items.map((entry) => entry.id === item.id ? { ...entry, kind: kind as PromptKind, isDefault: false } : entry))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(PROMPT_KIND_LABEL).map(([kind, label]) => <SelectItem key={kind} value={kind}>{label}</SelectItem>)}</SelectContent>
            </Select>
            <Button
              variant={item.isDefault ? "secondary" : "outline"}
              size="sm"
              onClick={() => persist(items.map((entry) => entry.kind === item.kind ? { ...entry, isDefault: entry.id === item.id } : entry))}
            >{item.isDefault ? "默认" : "设为默认"}</Button>
            <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => persist(items.filter((entry) => entry.id !== item.id))}><Trash2 /></Button>
          </div>
          <Textarea value={item.prompt} placeholder="输入提示词…" onChange={(event) => persist(items.map((entry) => entry.id === item.id ? { ...entry, prompt: event.target.value, updatedAt: Date.now() } : entry))} />
          <Input className="mt-2 h-8" value={item.tags.join(", ")} placeholder="标签，用逗号分隔" onChange={(event) => persist(items.map((entry) => entry.id === item.id ? { ...entry, tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) } : entry))} />
        </div>
      ))}
    </div>
  );
}

export function AiSettingsPane() {
  const snapshot = useAiConfigStore((state) => state.snapshot);
  const loading = useAiConfigStore((state) => state.loading);
  const error = useAiConfigStore((state) => state.error);
  const load = useAiConfigStore((state) => state.load);
  const reload = useAiConfigStore((state) => state.reload);
  const save = useAiConfigStore((state) => state.save);
  const [section, setSection] = useState<AiSection>("providers");
  const [config, setConfig] = useState<AiConfigV1 | null>(null);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);
  useEffect(() => {
    if (snapshot) setConfig(structuredClone(snapshot.config));
  }, [snapshot]);

  const saveConfig = async (nextConfig = config) => {
    if (!nextConfig) throw new Error("配置尚未加载");
    const next = await save(nextConfig);
    setConfig(structuredClone(next.config));
  };

  if (loading && !config) {
    return (
      <div className="flex h-72 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        正在加载独立 AI 配置
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
    <div>
      <div className="mb-5 flex items-start justify-between gap-4 rounded-lg border bg-muted/20 p-3">
        <div>
          <p className="text-sm font-medium">独立 AI 配置</p>
          <p className="text-xs text-muted-foreground">
            唯一来源为 ~/.mailuo/ai/config.json；不会读取 ~/.pi、项目 .pi、
            ~/.agents 或登录 shell 凭据。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void bridge?.openAiConfigDir().catch((cause) =>
                toast.error("打开目录失败", { description: String(cause) })
              )
            }
          >
            <FolderOpen />
            打开目录
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void reload()
                .then((next) => {
                  setConfig(structuredClone(next.config));
                  toast.success("已重新加载 config.json");
                })
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

      <div className="mb-5 flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1">
        {SECTION_ITEMS.map((item) => (
          <button
            type="button"
            key={item.key}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs",
              section === item.key
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setSection(item.key)}
          >
            <item.icon className="size-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      {section === "providers" && (
        <ProviderPane
          config={config}
          setConfig={setConfig}
          onSave={saveConfig}
        />
      )}
      {section === "models" && (
        <ModelsPane
          config={config}
          setConfig={setConfig}
          onSave={saveConfig}
        />
      )}
      {section === "routes" && (
        <RoutesPane
          config={config}
          setConfig={setConfig}
          onSave={saveConfig}
        />
      )}
      {section === "prompts" && <PromptTemplatesPane />}
      {section === "context" && (
        <ContextPane
          config={config}
          setConfig={setConfig}
          onSave={saveConfig}
        />
      )}
      {section === "network" && (
        <NetworkPane
          config={config}
          setConfig={setConfig}
          onSave={saveConfig}
        />
      )}
    </div>
  );
}

import { z } from "zod";

export const AI_USE_CASES = [
  "assistant",
  "project-plan",
  "task-breakdown",
  "dependency-suggest",
  "notes-polish",
] as const;

export const AI_API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "mistral-conversations",
] as const;

export const AI_PROVIDER_PRESETS = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "deepseek",
  "qwen",
  "kimi",
  "minimax",
  "zai",
  "xai",
  "mistral",
  "groq",
  "ollama",
  "lm-studio",
  "custom",
] as const;

export const AI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type AiUseCase = (typeof AI_USE_CASES)[number];
export type AiApiType = (typeof AI_API_TYPES)[number];
export type AiProviderPreset = (typeof AI_PROVIDER_PRESETS)[number];
export type AiThinkingLevel = (typeof AI_THINKING_LEVELS)[number];
export type AiAuthMode = "api-key" | "none" | "custom-headers";
export type AiDiscoveryAdapter =
  | "openai"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "manual";

/**
 * DeepSeek exposes its server-side web search only through the Responses API.
 * Keep this capability derived from the preset/protocol pair so it does not
 * require a config schema migration.
 */
export function usesDeepSeekWebSearch(
  provider: Pick<AiProviderConfig, "preset" | "api">
): boolean {
  return (
    provider.preset === "deepseek" && provider.api === "openai-responses"
  );
}

export const aiUseCaseSchema = z.enum(AI_USE_CASES);
const uuidSchema = z.string().uuid();
const nonEmptyStringSchema = z.string().trim().min(1);
const headerNameSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, "Header 名称无效");
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "cookie",
  "set-cookie",
]);

export const aiModelRefSchema = z
  .object({
    providerId: uuidSchema,
    modelId: nonEmptyStringSchema,
  })
  .strict();

export const aiCredentialDraftSchema = z
  .object({
    apiKey: z.string().optional(),
    secretHeaders: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const aiRequestContextSchema = z
  .object({
    projectSnapshot: z.string().optional(),
    taskDetails: z.string().optional(),
    conversationHistory: z.string().optional(),
    skillNames: z.array(z.string()).optional(),
    browserTabs: z
      .array(
        z
          .object({
            tabId: z.string(),
            title: z.string(),
            url: z.string(),
          })
          .strict()
      )
      .optional(),
  })
  .strict();

const openAiCompletionsCompatSchema = z
  .object({
    supportsStore: z.boolean().optional(),
    supportsDeveloperRole: z.boolean().optional(),
    supportsReasoningEffort: z.boolean().optional(),
    supportsUsageInStreaming: z.boolean().optional(),
    supportsStrictMode: z.boolean().optional(),
    maxTokensField: z
      .enum(["max_tokens", "max_completion_tokens"])
      .optional(),
    requiresToolResultName: z.boolean().optional(),
    requiresAssistantAfterToolResult: z.boolean().optional(),
    requiresThinkingAsText: z.boolean().optional(),
    requiresReasoningContentOnAssistantMessages: z.boolean().optional(),
    thinkingFormat: z
      .enum([
        "openai",
        "openrouter",
        "deepseek",
        "together",
        "zai",
        "qwen",
        "chat-template",
        "qwen-chat-template",
        "string-thinking",
        "ant-ling",
      ])
      .optional(),
    supportsLongCacheRetention: z.boolean().optional(),
  })
  .strict();

const openAiResponsesCompatSchema = z
  .object({
    supportsDeveloperRole: z.boolean().optional(),
    supportsLongCacheRetention: z.boolean().optional(),
    supportsStrictMode: z.boolean().optional(),
    supportsOpenAIGrammarTools: z.boolean().optional(),
    supportsToolSearch: z.boolean().optional(),
    supportsExplicitPromptCacheMode: z.boolean().optional(),
    sessionAffinityFormat: z
      .enum(["openai", "openai-nosession", "openrouter"])
      .optional(),
  })
  .strict();

const anthropicCompatSchema = z
  .object({
    supportsEagerToolInputStreaming: z.boolean().optional(),
    supportsLongCacheRetention: z.boolean().optional(),
    sendSessionAffinityHeaders: z.boolean().optional(),
    supportsCacheControlOnTools: z.boolean().optional(),
    supportsTemperature: z.boolean().optional(),
    forceAdaptiveThinking: z.boolean().optional(),
    allowEmptySignature: z.boolean().optional(),
    supportsStrictTools: z.boolean().optional(),
    supportsToolReferences: z.boolean().optional(),
  })
  .strict();

const protocolCompatSchema = z
  .object({
    openaiCompletions: openAiCompletionsCompatSchema.optional(),
    openaiResponses: openAiResponsesCompatSchema.optional(),
    anthropic: anthropicCompatSchema.optional(),
  })
  .strict();

export const aiProviderConfigSchema = z
  .object({
    id: uuidSchema,
    name: nonEmptyStringSchema,
    preset: z.enum(AI_PROVIDER_PRESETS),
    enabled: z.boolean(),
    baseUrl: z.string().url(),
    api: z.enum(AI_API_TYPES),
    authMode: z.enum(["api-key", "none", "custom-headers"]),
    authHeader: z.boolean(),
    headers: z.record(headerNameSchema, z.string()),
    secretHeaderNames: z.array(headerNameSchema),
    discovery: z
      .object({
        adapter: z.enum(["openai", "anthropic", "gemini", "ollama", "manual"]),
        url: z.union([z.literal(""), z.string().url()]).optional(),
      })
      .strict(),
    compat: protocolCompatSchema.optional(),
  })
  .strict()
  .superRefine((provider, ctx) => {
    const plain = new Set(
      Object.keys(provider.headers).map((name) => name.toLowerCase())
    );
    for (const name of provider.secretHeaderNames) {
      if (plain.has(name.toLowerCase())) {
        ctx.addIssue({
          code: "custom",
          message: `Header「${name}」不能同时是普通值和敏感值`,
          path: ["secretHeaderNames"],
        });
      }
    }
    for (const name of Object.keys(provider.headers)) {
      if (SENSITIVE_HEADER_NAMES.has(name.toLowerCase())) {
        ctx.addIssue({
          code: "custom",
          message: `敏感 Header「${name}」必须保存到 auth.json`,
          path: ["headers", name],
        });
      }
    }
  });

const costSchema = z
  .object({
    input: z.number().min(0),
    output: z.number().min(0),
    cacheRead: z.number().min(0),
    cacheWrite: z.number().min(0),
  })
  .strict();

export const aiModelConfigSchema = z
  .object({
    providerId: uuidSchema,
    modelId: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    enabled: z.boolean(),
    input: z.array(z.enum(["text", "image"])).min(1),
    reasoning: z.boolean(),
    thinkingLevelMap: z
      .partialRecord(z.enum(AI_THINKING_LEVELS), z.string().nullable())
      .optional(),
    contextWindow: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    cost: costSchema,
    compat: protocolCompatSchema.optional(),
    metadataSource: z.enum(["remote", "manual", "inferred"]),
    remoteStatus: z.enum(["found", "missing", "unknown"]),
  })
  .strict();

const contextSourceSchema = z
  .object({
    enabled: z.boolean(),
    maxChars: z.number().int().min(0),
  })
  .strict();

const piPackageConfigSchema = z
  .object({
    source: nonEmptyStringSchema,
    enabled: z.boolean(),
    installedPath: nonEmptyStringSchema.optional(),
  })
  .strict();

const piPathConfigSchema = z
  .object({
    path: nonEmptyStringSchema,
    enabled: z.boolean(),
    sourceKind: z.enum(["local", "terminal", "skills-sh"]),
    label: z.string().trim().optional(),
  })
  .strict();

const skillsShInstallSchema = z
  .object({
    id: nonEmptyStringSchema,
    source: nonEmptyStringSchema,
    skillNames: z.array(nonEmptyStringSchema),
    root: nonEmptyStringSchema,
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const aiPiConfigSchema = z
  .object({
    packages: z.array(piPackageConfigSchema).default([]),
    extensionPaths: z.array(piPathConfigSchema).default([]),
    skillPaths: z.array(piPathConfigSchema).default([]),
    extensionOverrides: z.record(z.string(), z.boolean()).default({}),
    skillProfileIds: z.record(z.string(), z.array(uuidSchema)).default({}),
    skillsSh: z
      .object({
        installs: z.array(skillsShInstallSchema).default([]),
      })
      .strict()
      .default({ installs: [] }),
  })
  .strict();

export type AiPiConfig = z.infer<typeof aiPiConfigSchema>;
export type AiPiPackageConfig = AiPiConfig["packages"][number];
export type AiPiPathConfig = AiPiConfig["extensionPaths"][number];
export type SkillsShInstall = AiPiConfig["skillsSh"]["installs"][number];

export function createDefaultAiPiConfig(): AiPiConfig {
  return {
    packages: [],
    extensionPaths: [],
    skillPaths: [],
    extensionOverrides: {},
    skillProfileIds: {},
    skillsSh: { installs: [] },
  };
}

export const aiContextProfileSchema = z
  .object({
    id: uuidSchema,
    name: nonEmptyStringSchema,
    appendSystemPrompt: z.string(),
    sources: z
      .object({
        projectSnapshot: contextSourceSchema,
        taskDetails: contextSourceSchema,
        longTermMemory: contextSourceSchema,
        conversationHistory: contextSourceSchema,
        skills: contextSourceSchema,
        attachments: z
          .object({
            enabled: z.boolean(),
            maxCount: z.number().int().min(0).max(32),
            maxBytes: z.number().int().min(0),
            maxTextChars: z.number().int().min(0),
          })
          .strict(),
      })
      .strict(),
    compaction: z
      .object({
        enabled: z.boolean(),
        reserveTokens: z.number().int().min(0),
        keepRecentTokens: z.number().int().min(0),
      })
      .strict(),
    retry: z
      .object({
        enabled: z.boolean(),
        maxAttempts: z.number().int().min(0).max(10),
        baseDelayMs: z.number().int().min(0),
        maxDelayMs: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

export const aiRouteConfigSchema = z
  .object({
    model: aiModelRefSchema.nullable(),
    thinkingLevel: z.enum(AI_THINKING_LEVELS),
    contextProfileId: uuidSchema,
  })
  .strict();

export const aiConfigV1Schema = z
  .object({
    version: z.literal(1),
    providers: z.array(aiProviderConfigSchema),
    models: z.array(aiModelConfigSchema),
    routes: z
      .object({
        assistant: aiRouteConfigSchema,
        "project-plan": aiRouteConfigSchema,
        "task-breakdown": aiRouteConfigSchema,
        "dependency-suggest": aiRouteConfigSchema,
        "notes-polish": aiRouteConfigSchema,
      })
      .strict(),
    contextProfiles: z.array(aiContextProfileSchema).min(1),
    pi: aiPiConfigSchema.default(createDefaultAiPiConfig()),
    network: z
      .object({
        httpProxy: z.string(),
        httpsProxy: z.string(),
        noProxy: z.string(),
      })
      .strict(),
  })
  .strict();

export type AiModelRef = z.infer<typeof aiModelRefSchema>;
export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>;
export type AiModelConfig = z.infer<typeof aiModelConfigSchema>;
export type AiRouteConfig = z.infer<typeof aiRouteConfigSchema>;
export type AiContextProfile = z.infer<typeof aiContextProfileSchema>;
export type AiConfigV1 = z.infer<typeof aiConfigV1Schema>;

export interface DiscoveredModel {
  modelId: string;
  name: string;
  input: ("text" | "image")[];
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  metadataSource: "remote" | "inferred";
  rawCapabilities?: string[];
}

export interface AuthStatus {
  providerId: string;
  configured: boolean;
  mode: AiAuthMode;
  apiKeyMask?: string;
  secretHeaders: { name: string; configured: boolean; mask?: string }[];
}

export interface AiConfigSnapshot {
  config: AiConfigV1;
  etag: string | null;
  authStatus: AuthStatus[];
}

export interface AiCredentialDraft {
  apiKey?: string;
  secretHeaders?: Record<string, string>;
}

export interface AiRequestContext {
  projectSnapshot?: string;
  taskDetails?: string;
  conversationHistory?: string;
  skillNames?: string[];
  browserTabs?: { tabId: string; title: string; url: string }[];
}

export interface EnabledModelSummary {
  providerId: string;
  providerName: string;
  modelId: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
}

export interface RouteResolutionStatus {
  useCase: AiUseCase;
  ready: boolean;
  message?: string;
  model?: EnabledModelSummary;
}

export const FULL_CONTEXT_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
export const COMPACT_CONTEXT_PROFILE_ID =
  "22222222-2222-4222-8222-222222222222";

function source(enabled: boolean, maxChars: number) {
  return { enabled, maxChars };
}

export function createDefaultAiConfig(): AiConfigV1 {
  const contextProfiles: AiContextProfile[] = [
    {
      id: FULL_CONTEXT_PROFILE_ID,
      name: "助手完整",
      appendSystemPrompt: "",
      sources: {
        projectSnapshot: source(true, 24_000),
        taskDetails: source(true, 12_000),
        longTermMemory: source(true, 4_000),
        conversationHistory: source(true, 16_000),
        skills: source(true, 12_000),
        attachments: {
          enabled: true,
          maxCount: 8,
          maxBytes: 25 * 1024 * 1024,
          maxTextChars: 100_000,
        },
      },
      compaction: {
        enabled: true,
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
      },
      retry: {
        enabled: true,
        maxAttempts: 2,
        baseDelayMs: 1_000,
        maxDelayMs: 30_000,
      },
    },
    {
      id: COMPACT_CONTEXT_PROFILE_ID,
      name: "任务精简",
      appendSystemPrompt: "",
      sources: {
        projectSnapshot: source(true, 12_000),
        taskDetails: source(true, 8_000),
        longTermMemory: source(false, 0),
        conversationHistory: source(false, 0),
        skills: source(false, 0),
        attachments: {
          enabled: false,
          maxCount: 0,
          maxBytes: 0,
          maxTextChars: 0,
        },
      },
      compaction: {
        enabled: false,
        reserveTokens: 8_192,
        keepRecentTokens: 8_000,
      },
      retry: {
        enabled: true,
        maxAttempts: 2,
        baseDelayMs: 800,
        maxDelayMs: 10_000,
      },
    },
  ];
  const route = (contextProfileId: string): AiRouteConfig => ({
    model: null,
    thinkingLevel: "off",
    contextProfileId,
  });
  return {
    version: 1,
    providers: [],
    models: [],
    routes: {
      assistant: route(FULL_CONTEXT_PROFILE_ID),
      "project-plan": route(COMPACT_CONTEXT_PROFILE_ID),
      "task-breakdown": route(COMPACT_CONTEXT_PROFILE_ID),
      "dependency-suggest": route(COMPACT_CONTEXT_PROFILE_ID),
      "notes-polish": route(COMPACT_CONTEXT_PROFILE_ID),
    },
    contextProfiles,
    pi: createDefaultAiPiConfig(),
    network: { httpProxy: "", httpsProxy: "", noProxy: "" },
  };
}

export function runtimeProviderId(providerId: string): string {
  return `mailuo-${providerId}`;
}

export function modelRefKey(ref: AiModelRef): string {
  return `${ref.providerId}/${ref.modelId}`;
}

export function validateAiConfigReferences(config: AiConfigV1): string[] {
  const issues: string[] = [];
  const providerIds = new Set<string>();
  for (const provider of config.providers) {
    if (providerIds.has(provider.id)) {
      issues.push(`Provider ID 重复：${provider.id}`);
    }
    providerIds.add(provider.id);
  }

  const modelKeys = new Set<string>();
  for (const model of config.models) {
    if (!providerIds.has(model.providerId)) {
      issues.push(`模型「${model.name}」引用了不存在的 Provider`);
    }
    const key = modelRefKey(model);
    if (modelKeys.has(key)) issues.push(`模型引用重复：${key}`);
    modelKeys.add(key);
  }

  const contextIds = new Set<string>();
  for (const profile of config.contextProfiles) {
    if (contextIds.has(profile.id)) {
      issues.push(`上下文配置档 ID 重复：${profile.id}`);
    }
    contextIds.add(profile.id);
  }

  for (const useCase of AI_USE_CASES) {
    const route = config.routes[useCase];
    if (!contextIds.has(route.contextProfileId)) {
      issues.push(`用途「${useCase}」引用了不存在的上下文配置档`);
    }
    if (route.model && !modelKeys.has(modelRefKey(route.model))) {
      issues.push(`用途「${useCase}」引用了不存在的模型`);
    }
  }

  for (const [skillId, profileIds] of Object.entries(config.pi.skillProfileIds)) {
    for (const profileId of profileIds) {
      if (!contextIds.has(profileId)) {
        issues.push(`Skill「${skillId}」引用了不存在的上下文配置档`);
      }
    }
  }
  return issues;
}

export function collectAiConfigReferences(
  config: AiConfigV1,
  target:
    | { type: "provider"; id: string }
    | { type: "model"; ref: AiModelRef }
    | { type: "context"; id: string }
): string[] {
  const references: string[] = [];
  for (const useCase of AI_USE_CASES) {
    const route = config.routes[useCase];
    if (
      target.type === "provider" &&
      route.model?.providerId === target.id
    ) {
      references.push(`用途路由：${useCase}`);
    } else if (
      target.type === "model" &&
      route.model &&
      modelRefKey(route.model) === modelRefKey(target.ref)
    ) {
      references.push(`用途路由：${useCase}`);
    } else if (
      target.type === "context" &&
      route.contextProfileId === target.id
    ) {
      references.push(`用途路由：${useCase}`);
    }
  }
  if (target.type === "provider") {
    for (const model of config.models) {
      if (model.providerId === target.id) {
        references.push(`模型：${model.name}`);
      }
    }
  }
  return references;
}

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";
import { z } from "zod";
import {
  aiConfigV1Schema,
  createDefaultAiConfig,
  runtimeProviderId,
  validateAiConfigReferences,
  type AiConfigSnapshot,
  type AiConfigV1,
  type AiCredentialDraft,
  type AiProviderConfig,
  type AuthStatus,
} from "../src/shared/ai-config";

export const MAILUO_AI_HOME = path.join(os.homedir(), ".mailuo", "ai");
export const AI_CONFIG_PATH = path.join(MAILUO_AI_HOME, "config.json");
export const AI_AUTH_PATH = path.join(MAILUO_AI_HOME, "auth.json");
export const AI_CATALOG_CACHE_DIR = path.join(
  MAILUO_AI_HOME,
  "catalog-cache"
);
export const AI_SKILLS_DIR = path.join(MAILUO_AI_HOME, "skills");

const credentialSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("api_key"),
      key: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
    })
    .catchall(z.unknown()),
]);
const credentialFileSchema = z.record(z.string(), credentialSchema);

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function picked(
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => key in source).map((key) => [key, source[key]])
  );
}

/**
 * Normalizes the short-lived pre-release V1 compat keys written by development
 * builds. This only touches the app's own config document and never imports pi
 * CLI configuration.
 */
function normalizeLegacyV1Compat(input: unknown): unknown {
  const root = record(input);
  if (root?.version !== 1) return input;
  const clone = structuredClone(root);
  const providers = Array.isArray(clone.providers) ? clone.providers : [];
  const providerApis = new Map<string, string>();
  for (const value of providers) {
    const provider = record(value);
    if (
      provider &&
      typeof provider.id === "string" &&
      typeof provider.api === "string"
    ) {
      providerApis.set(provider.id, provider.api);
    }
  }
  const entries = [
    ...providers.map((value) => ({
      value,
      api: record(value)?.api,
    })),
    ...(Array.isArray(clone.models) ? clone.models : []).map((value) => ({
      value,
      api: providerApis.get(String(record(value)?.providerId ?? "")),
    })),
  ];
  for (const entry of entries) {
    const target = record(entry.value);
    const compat = record(target?.compat);
    if (!target || !compat) continue;
    const next: Record<string, unknown> = { ...compat };
    const legacyOpenAi = record(compat.openai);
    if (legacyOpenAi) {
      if (entry.api === "openai-responses") {
        next.openaiResponses = picked(legacyOpenAi, [
          "supportsDeveloperRole",
          "supportsStrictMode",
        ]);
      } else if (entry.api === "openai-completions") {
        next.openaiCompletions = picked(legacyOpenAi, [
          "supportsDeveloperRole",
          "supportsReasoningEffort",
          "supportsStrictMode",
          "maxTokensField",
          "requiresToolResultName",
          "requiresAssistantAfterToolResult",
          "requiresThinkingAsText",
          "thinkingFormat",
        ]);
      }
      delete next.openai;
    }
    const legacyAnthropic = record(compat.anthropic);
    if (
      legacyAnthropic &&
      ("supportsPromptCaching" in legacyAnthropic ||
        "supportsAdaptiveThinking" in legacyAnthropic)
    ) {
      next.anthropic = {
        ...legacyAnthropic,
        ...("supportsPromptCaching" in legacyAnthropic
          ? {
              supportsCacheControlOnTools:
                legacyAnthropic.supportsPromptCaching,
            }
          : {}),
        ...("supportsAdaptiveThinking" in legacyAnthropic
          ? {
              forceAdaptiveThinking:
                legacyAnthropic.supportsAdaptiveThinking,
            }
          : {}),
      };
      const anthropic = next.anthropic as Record<string, unknown>;
      delete anthropic.supportsPromptCaching;
      delete anthropic.supportsAdaptiveThinking;
      delete anthropic.supportsInterleavedThinking;
    }
    delete next.google;
    target.compat = next;
  }
  return clone;
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(
  file: string,
  content: string,
  mode: number
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(temp, content, { encoding: "utf8", mode });
    await fs.chmod(temp, mode);
    await fs.rename(temp, file);
    await fs.chmod(file, mode);
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    throw error;
  }
}

export class AiConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`AI 配置无效：${issues.join("；")}`);
    this.name = "AiConfigValidationError";
  }
}

export class AiConfigWriteConflictError extends Error {
  constructor() {
    super("config.json 已在应用外修改，请重新加载后再保存");
    this.name = "AiConfigWriteConflictError";
  }
}

export class AiConfigStore {
  readonly configPath: string;
  readonly authPath: string;
  readonly catalogCacheDir: string;
  readonly skillsDir: string;
  readonly credentials: MailuoCredentialStore;

  constructor(readonly root = MAILUO_AI_HOME) {
    this.configPath = path.join(root, "config.json");
    this.authPath = path.join(root, "auth.json");
    this.catalogCacheDir = path.join(root, "catalog-cache");
    this.skillsDir = path.join(root, "skills");
    this.credentials = new MailuoCredentialStore(this.authPath);
  }

  async ensureDirectories(): Promise<void> {
    await Promise.all([
      fs.mkdir(this.root, { recursive: true }),
      fs.mkdir(this.catalogCacheDir, { recursive: true }),
      fs.mkdir(this.skillsDir, { recursive: true }),
    ]);
  }

  async load(): Promise<AiConfigSnapshot> {
    await this.ensureDirectories();
    const raw = await readOptional(this.configPath);
    const config = raw === null ? createDefaultAiConfig() : this.parse(raw);
    return {
      config,
      etag: raw === null ? null : hash(raw),
      authStatus: await this.authStatuses(config),
    };
  }

  async save(
    input: AiConfigV1,
    expectedEtag: string | null
  ): Promise<AiConfigSnapshot> {
    await this.ensureDirectories();
    const current = await readOptional(this.configPath);
    const currentEtag = current === null ? null : hash(current);
    if (currentEtag !== expectedEtag) throw new AiConfigWriteConflictError();

    const config = this.validate(input);
    const content = `${JSON.stringify(config, null, 2)}\n`;
    await atomicWrite(this.configPath, content, 0o600);
    return {
      config,
      etag: hash(content),
      authStatus: await this.authStatuses(config),
    };
  }

  parse(raw: string): AiConfigV1 {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new AiConfigValidationError([
        `config.json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
    return this.validate(normalizeLegacyV1Compat(value));
  }

  validate(input: unknown): AiConfigV1 {
    const parsed = aiConfigV1Schema.safeParse(input);
    if (!parsed.success) {
      throw new AiConfigValidationError(
        parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "root"}：${issue.message}`
        )
      );
    }
    const issues = validateAiConfigReferences(parsed.data);
    if (issues.length) throw new AiConfigValidationError(issues);
    return parsed.data;
  }

  async saveCredential(
    provider: AiProviderConfig,
    draft: AiCredentialDraft
  ): Promise<AuthStatus> {
    const providerId = runtimeProviderId(provider.id);
    if (provider.authMode === "none") {
      await this.credentials.delete(providerId);
    } else {
      const credential = await this.resolveCredential(provider, draft);
      if (!credential) throw new Error("请填写 Provider 凭据");
      await this.credentials.modify(providerId, async () => credential);
    }
    return this.authStatus(provider);
  }

  async resolveCredential(
    provider: AiProviderConfig,
    draft: AiCredentialDraft = {}
  ): Promise<Credential | undefined> {
    if (provider.authMode === "none") return undefined;
    const current = await this.credentials.read(runtimeProviderId(provider.id));
    const currentApiKey = current?.type === "api_key" ? current.key : undefined;
    const currentEnv =
      current?.type === "api_key" ? { ...(current.env ?? {}) } : {};
    const env: Record<string, string> = {};
    for (const header of provider.secretHeaderNames) {
      const key = secretHeaderEnvName(provider.id, header);
      const next = draft.secretHeaders?.[header];
      const value = next?.trim() ? next : currentEnv[key];
      if (value) env[key] = value;
    }
    const apiKey = draft.apiKey?.trim() || currentApiKey;
    if (provider.authMode === "api-key" && !apiKey) {
      throw new Error("请填写 API Key");
    }
    if (
      provider.authMode === "custom-headers" &&
      provider.secretHeaderNames.some(
        (header) => !env[secretHeaderEnvName(provider.id, header)]
      )
    ) {
      throw new Error("请填写所有敏感 Header 的值");
    }
    return {
      type: "api_key",
      key:
        provider.authMode === "custom-headers"
          ? apiKey || "mailuo-custom-headers"
          : apiKey,
      ...(Object.keys(env).length ? { env } : {}),
    };
  }

  async deleteCredential(providerId: string): Promise<void> {
    await this.credentials.delete(runtimeProviderId(providerId));
  }

  async authStatuses(config: AiConfigV1): Promise<AuthStatus[]> {
    return Promise.all(
      config.providers.map((provider) => this.authStatus(provider))
    );
  }

  async authStatus(provider: AiProviderConfig): Promise<AuthStatus> {
    const credential = await this.credentials.read(runtimeProviderId(provider.id));
    const apiKey =
      credential?.type === "api_key" ? credential.key?.trim() : undefined;
    const env =
      credential?.type === "api_key" ? credential.env ?? {} : {};
    const secretHeaders = provider.secretHeaderNames.map((name) => {
      const configured = Boolean(env[secretHeaderEnvName(provider.id, name)]);
      return { name, configured, ...(configured ? { mask: "••••••••" } : {}) };
    });
    const configured =
      provider.authMode === "none" ||
      (provider.authMode === "api-key"
        ? Boolean(apiKey)
        : secretHeaders.every((header) => header.configured));
    return {
      providerId: provider.id,
      configured,
      mode: provider.authMode,
      ...(provider.authMode === "api-key" && apiKey
        ? { apiKeyMask: maskSecret(apiKey) }
        : {}),
      secretHeaders,
    };
  }
}

export function secretHeaderEnvName(
  providerId: string,
  headerName: string
): string {
  return `MAILUO_HEADER_${providerId}_${headerName}`
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_");
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return "••••••••";
  return `${secret.slice(0, 3)}••••${secret.slice(-3)}`;
}

export class MailuoCredentialStore implements CredentialStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly authPath = AI_AUTH_PATH) {}

  async read(providerId: string): Promise<Credential | undefined> {
    const data = await this.readAll();
    return data[providerId] ? structuredClone(data[providerId]) : undefined;
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const data = await this.readAll();
    return Object.entries(data).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    return this.serialized(async () => {
      const data = await this.readAll();
      const next = await fn(
        data[providerId] ? structuredClone(data[providerId]) : undefined
      );
      if (next === undefined) return data[providerId];
      data[providerId] = next;
      await this.writeAll(data);
      return structuredClone(next);
    });
  }

  async delete(providerId: string): Promise<void> {
    await this.serialized(async () => {
      const data = await this.readAll();
      if (!(providerId in data)) return;
      delete data[providerId];
      await this.writeAll(data);
    });
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async readAll(): Promise<Record<string, Credential>> {
    const raw = await readOptional(this.authPath);
    if (raw === null) return {};
    await fs.chmod(this.authPath, 0o600);
    const parsed = credentialFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`auth.json 无效：${parsed.error.message}`);
    }
    return parsed.data as Record<string, Credential>;
  }

  private async writeAll(data: Record<string, Credential>): Promise<void> {
    await atomicWrite(
      this.authPath,
      `${JSON.stringify(data, null, 2)}\n`,
      0o600
    );
  }
}

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import type {
  AiProviderConfig,
  DiscoveredModel,
} from "../src/shared/ai-config";
import { secretHeaderEnvName } from "./ai-config-store";

const INFERRED_CONTEXT_WINDOW = 128_000;
const INFERRED_MAX_TOKENS = 16_384;
const ERROR_BODY_LIMIT = 1_000;

export class ModelDiscoveryError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ModelDiscoveryError";
  }
}

export interface DiscoveryOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

type JsonRecord = Record<string, unknown>;

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function modelDefaults(
  modelId: string,
  name = modelId
): DiscoveredModel {
  const lower = modelId.toLowerCase();
  return {
    modelId,
    name,
    input: /vision|image|vl(?:-|$)|gpt-4o|gemini/i.test(lower)
      ? ["text", "image"]
      : ["text"],
    reasoning: /reason|thinking|o[134](?:-|$)|r1|qwen3/i.test(lower),
    contextWindow: INFERRED_CONTEXT_WINDOW,
    maxTokens: INFERRED_MAX_TOKENS,
    metadataSource: "inferred",
  };
}

function buildHeaders(
  provider: AiProviderConfig,
  credential?: Credential
): Headers {
  const headers = new Headers(provider.headers);
  const apiCredential =
    credential?.type === "api_key" ? credential : undefined;
  for (const name of provider.secretHeaderNames) {
    const value = apiCredential?.env?.[secretHeaderEnvName(provider.id, name)];
    if (value) headers.set(name, value);
  }
  if (
    provider.authMode === "api-key" &&
    provider.authHeader &&
    apiCredential?.key &&
    provider.discovery.adapter !== "gemini"
  ) {
    if (provider.discovery.adapter === "anthropic") {
      headers.set("x-api-key", apiCredential.key);
      if (!headers.has("anthropic-version")) {
        headers.set("anthropic-version", "2023-06-01");
      }
    } else {
      headers.set("authorization", `Bearer ${apiCredential.key}`);
    }
  }
  headers.set("accept", "application/json");
  return headers;
}

function discoveryUrl(provider: AiProviderConfig): URL {
  if (provider.discovery.url?.trim()) {
    return new URL(provider.discovery.url.trim());
  }
  const base = new URL(provider.baseUrl);
  switch (provider.discovery.adapter) {
    case "openai":
      return new URL(`${trimSlash(base.toString())}/models`);
    case "anthropic": {
      const value = trimSlash(base.toString());
      return new URL(
        /\/v1$/i.test(new URL(value).pathname)
          ? `${value}/models`
          : `${value}/v1/models`
      );
    }
    case "gemini":
      return new URL(`${trimSlash(base.toString())}/models`);
    case "ollama":
      return new URL("/api/tags", base.origin);
    case "manual":
      return base;
  }
}

function createSignal(
  external: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(external?.reason);
  external?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("timeout")),
    timeoutMs
  );
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", abort);
    },
  };
}

function secretValues(credential?: Credential): string[] {
  if (credential?.type !== "api_key") return [];
  return [credential.key, ...Object.values(credential.env ?? {})].filter(
    (value): value is string => Boolean(value)
  );
}

function redact(value: string, credential?: Credential): string {
  let result = value;
  for (const secret of secretValues(credential)) {
    result = result.split(secret).join("[REDACTED]");
  }
  return result.slice(0, ERROR_BODY_LIMIT);
}

async function fetchJson(
  fetcher: typeof globalThis.fetch,
  url: URL,
  init: RequestInit,
  credential?: Credential
): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch (error) {
    if (init.signal instanceof AbortSignal && init.signal.aborted) {
      throw new ModelDiscoveryError("模型发现请求已取消或超时");
    }
    throw new ModelDiscoveryError(
      `模型发现请求失败：${redact(
        error instanceof Error ? error.message : String(error),
        credential
      )}`
    );
  }
  const body = await response.text();
  if (!response.ok) {
    throw new ModelDiscoveryError(
      `模型发现失败（HTTP ${response.status}）：${redact(body, credential)}`,
      response.status
    );
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("响应根节点不是对象");
    }
    return parsed as JsonRecord;
  } catch (error) {
    throw new ModelDiscoveryError(
      `模型发现响应不是合法 JSON：${redact(
        error instanceof Error ? error.message : String(error),
        credential
      )}`
    );
  }
}

function readRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function openAiModels(payload: JsonRecord): DiscoveredModel[] {
  return readRecords(payload.data)
    .map((item) => (typeof item.id === "string" ? item.id : ""))
    .filter(Boolean)
    .map((id) => modelDefaults(id));
}

function anthropicModels(payload: JsonRecord): DiscoveredModel[] {
  return readRecords(payload.data).flatMap((item) => {
    if (typeof item.id !== "string") return [];
    return [
      modelDefaults(
        item.id,
        typeof item.display_name === "string" ? item.display_name : item.id
      ),
    ];
  });
}

function geminiModels(payload: JsonRecord): DiscoveredModel[] {
  return readRecords(payload.models).flatMap((item) => {
    if (typeof item.name !== "string") return [];
    const modelId = item.name.replace(/^models\//, "");
    const base = modelDefaults(
      modelId,
      typeof item.displayName === "string" ? item.displayName : modelId
    );
    const contextWindow = positiveNumber(item.inputTokenLimit);
    const maxTokens = positiveNumber(item.outputTokenLimit);
    return [
      {
        ...base,
        ...(contextWindow ? { contextWindow } : {}),
        ...(maxTokens ? { maxTokens } : {}),
        metadataSource:
          contextWindow && maxTokens ? ("remote" as const) : ("inferred" as const),
        ...(Array.isArray(item.supportedGenerationMethods)
          ? {
              rawCapabilities: item.supportedGenerationMethods.filter(
                (entry): entry is string => typeof entry === "string"
              ),
            }
          : {}),
      },
    ];
  });
}

function ollamaModels(payload: JsonRecord): DiscoveredModel[] {
  return readRecords(payload.models).flatMap((item) => {
    const id =
      typeof item.name === "string"
        ? item.name
        : typeof item.model === "string"
          ? item.model
          : "";
    return id ? [modelDefaults(id)] : [];
  });
}

export async function discoverModels(
  provider: AiProviderConfig,
  credential?: Credential,
  options: DiscoveryOptions = {}
): Promise<DiscoveredModel[]> {
  if (provider.discovery.adapter === "manual") {
    throw new ModelDiscoveryError("此 Provider 仅支持手工添加模型");
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  const lifecycle = createSignal(options.signal, options.timeoutMs ?? 15_000);
  const headers = buildHeaders(provider, credential);
  const startUrl = discoveryUrl(provider);
  const apiKey =
    credential?.type === "api_key" ? credential.key?.trim() : undefined;
  try {
    if (provider.discovery.adapter === "gemini") {
      if (provider.authMode === "api-key" && !apiKey) {
        throw new ModelDiscoveryError("Gemini 模型发现缺少 API Key");
      }
      const models: DiscoveredModel[] = [];
      let pageToken = "";
      do {
        const url = new URL(startUrl);
        if (apiKey) url.searchParams.set("key", apiKey);
        url.searchParams.set("pageSize", "1000");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const payload = await fetchJson(
          fetcher,
          url,
          { headers, signal: lifecycle.signal },
          credential
        );
        models.push(...geminiModels(payload));
        pageToken =
          typeof payload.nextPageToken === "string"
            ? payload.nextPageToken
            : "";
      } while (pageToken);
      return models;
    }

    if (provider.discovery.adapter === "anthropic") {
      const models: DiscoveredModel[] = [];
      let afterId = "";
      do {
        const url = new URL(startUrl);
        url.searchParams.set("limit", "1000");
        if (afterId) url.searchParams.set("after_id", afterId);
        const payload = await fetchJson(
          fetcher,
          url,
          { headers, signal: lifecycle.signal },
          credential
        );
        models.push(...anthropicModels(payload));
        afterId =
          payload.has_more === true && typeof payload.last_id === "string"
            ? payload.last_id
            : "";
      } while (afterId);
      return models;
    }

    const payload = await fetchJson(
      fetcher,
      startUrl,
      { headers, signal: lifecycle.signal },
      credential
    );
    return provider.discovery.adapter === "ollama"
      ? ollamaModels(payload)
      : openAiModels(payload);
  } finally {
    lifecycle.dispose();
  }
}

export async function cacheDiscoveredModels(
  cacheDir: string,
  providerId: string,
  models: DiscoveredModel[]
): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${providerId}.json`);
  const temp = path.join(cacheDir, `.${providerId}.${randomUUID()}.tmp`);
  const content = `${JSON.stringify(
    { providerId, fetchedAt: new Date().toISOString(), models },
    null,
    2
  )}\n`;
  try {
    await fs.writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, file);
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    throw error;
  }
}

export async function testProviderConnection(
  provider: AiProviderConfig,
  credential?: Credential,
  options: DiscoveryOptions = {}
): Promise<{ ok: true; message: string }> {
  if (provider.discovery.adapter !== "manual") {
    const models = await discoverModels(provider, credential, options);
    return { ok: true, message: `连接成功，发现 ${models.length} 个模型` };
  }
  const lifecycle = createSignal(options.signal, options.timeoutMs ?? 10_000);
  try {
    const response = await (options.fetch ?? globalThis.fetch)(provider.baseUrl, {
      method: "GET",
      headers: buildHeaders(provider, credential),
      signal: lifecycle.signal,
    });
    if (!response.ok) {
      throw new ModelDiscoveryError(
        `连接失败（HTTP ${response.status}）`,
        response.status
      );
    }
    return { ok: true, message: "连接成功" };
  } finally {
    lifecycle.dispose();
  }
}

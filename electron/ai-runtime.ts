import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  AnthropicMessagesCompat,
  Api,
  Model,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
  ThinkingLevel,
} from "@earendil-works/pi-ai";
import {
  AI_USE_CASES,
  modelRefKey,
  runtimeProviderId,
  type AiConfigSnapshot,
  type AiConfigV1,
  type AiContextProfile,
  type AiCredentialDraft,
  type AiModelConfig,
  type AiModelRef,
  type AiProviderConfig,
  type AiThinkingLevel,
  type AiUseCase,
  type EnabledModelSummary,
  type RouteResolutionStatus,
} from "../src/shared/ai-config";
import {
  AiConfigStore,
  secretHeaderEnvName,
} from "./ai-config-store";

export interface ResolvedAiRoute {
  useCase: AiUseCase;
  runtimeProviderId: string;
  provider: AiProviderConfig;
  modelConfig: AiModelConfig;
  model: Model<Api>;
  thinkingLevel: AiThinkingLevel;
  contextProfile: AiContextProfile;
  configEtag: string | null;
}

interface RuntimeState {
  snapshot: AiConfigSnapshot;
  runtime: ModelRuntime;
}

type RegisteredProviderConfig = Parameters<ModelRuntime["registerProvider"]>[1];

function protocolCompat(
  provider: AiProviderConfig,
  model: AiModelConfig
):
  | OpenAICompletionsCompat
  | OpenAIResponsesCompat
  | AnthropicMessagesCompat
  | undefined {
  if (provider.api === "openai-completions") {
    const base = provider.compat?.openaiCompletions;
    const override = model.compat?.openaiCompletions;
    return base || override ? { ...base, ...override } : undefined;
  }
  if (provider.api === "openai-responses") {
    const base = provider.compat?.openaiResponses;
    const override = model.compat?.openaiResponses;
    return base || override ? { ...base, ...override } : undefined;
  }
  if (provider.api === "anthropic-messages") {
    const base = provider.compat?.anthropic;
    const override = model.compat?.anthropic;
    return base || override ? { ...base, ...override } : undefined;
  }
  return undefined;
}

function providerRegistration(
  provider: AiProviderConfig,
  models: AiModelConfig[]
): RegisteredProviderConfig {
  const headers: Record<string, string> = { ...provider.headers };
  for (const name of provider.secretHeaderNames) {
    headers[name] = `$${secretHeaderEnvName(provider.id, name)}`;
  }
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    api: provider.api,
    ...(provider.authMode === "none" ? { apiKey: "mailuo-no-auth" } : {}),
    authHeader: provider.authHeader,
    ...(Object.keys(headers).length ? { headers } : {}),
    models: models.map((model) => ({
      id: model.modelId,
      name: model.name,
      api: provider.api,
      reasoning: model.reasoning,
      ...(model.thinkingLevelMap
        ? { thinkingLevelMap: model.thinkingLevelMap }
        : {}),
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      ...(protocolCompat(provider, model)
        ? { compat: protocolCompat(provider, model) }
        : {}),
    })),
  };
}

function applyNetworkConfig(config: AiConfigV1): void {
  const values: Array<[string[], string]> = [
    [["http_proxy", "HTTP_PROXY"], config.network.httpProxy.trim()],
    [["https_proxy", "HTTPS_PROXY"], config.network.httpsProxy.trim()],
    [["no_proxy", "NO_PROXY"], config.network.noProxy.trim()],
  ];
  for (const [names, value] of values) {
    for (const name of names) {
      if (value) process.env[name] = value;
      else delete process.env[name];
    }
  }
}

export class AiRuntimeManager {
  private state: RuntimeState | null = null;
  private loading: Promise<RuntimeState> | null = null;

  constructor(readonly store = new AiConfigStore()) {}

  async snapshot(): Promise<AiConfigSnapshot> {
    return (await this.ensureState()).snapshot;
  }

  async reload(): Promise<AiConfigSnapshot> {
    const snapshot = await this.store.load();
    const next = await this.buildState(snapshot);
    this.state = next;
    applyNetworkConfig(snapshot.config);
    return snapshot;
  }

  async saveConfig(
    config: AiConfigV1,
    expectedEtag: string | null
  ): Promise<AiConfigSnapshot> {
    const previous =
      this.state?.snapshot.config ?? (await this.store.load()).config;
    const validated = this.store.validate(config);
    const candidate: AiConfigSnapshot = {
      config: validated,
      etag: expectedEtag,
      authStatus: await this.store.authStatuses(validated),
    };
    const next = await this.buildState(candidate);
    const saved = await this.store.save(validated, expectedEtag);
    const nextProviderIds = new Set(
      saved.config.providers.map((provider) => provider.id)
    );
    await Promise.all(
      previous.providers
        .filter((provider) => !nextProviderIds.has(provider.id))
        .map((provider) => this.store.deleteCredential(provider.id))
    );
    next.snapshot = saved;
    this.state = next;
    applyNetworkConfig(saved.config);
    return saved;
  }

  async saveProviderConfig(
    configInput: AiConfigV1,
    expectedEtag: string | null,
    providerInput: AiProviderConfig,
    draft: AiCredentialDraft
  ): Promise<AiConfigSnapshot> {
    const config = this.store.validate(configInput);
    const provider = config.providers.find(
      (entry) => entry.id === providerInput.id
    );
    if (!provider || JSON.stringify(provider) !== JSON.stringify(providerInput)) {
      throw new Error("Provider 草稿与待保存配置不一致");
    }
    const providerId = runtimeProviderId(provider.id);
    const previous = await this.store.credentials.read(providerId);
    try {
      await this.store.saveCredential(provider, draft);
      return await this.saveConfig(config, expectedEtag);
    } catch (error) {
      if (previous) {
        await this.store.credentials.modify(providerId, async () => previous);
      } else {
        await this.store.credentials.delete(providerId);
      }
      throw error;
    }
  }

  async listEnabledModels(): Promise<EnabledModelSummary[]> {
    const { snapshot } = await this.ensureState();
    const providers = new Map(
      snapshot.config.providers
        .filter((provider) => provider.enabled)
        .map((provider) => [provider.id, provider])
    );
    return snapshot.config.models.flatMap((model) => {
      const provider = providers.get(model.providerId);
      if (!provider || !model.enabled) return [];
      return [
        {
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.modelId,
          name: model.name,
          reasoning: model.reasoning,
          input: model.input,
        },
      ];
    });
  }

  async routeStatuses(): Promise<RouteResolutionStatus[]> {
    return Promise.all(
      AI_USE_CASES.map(async (useCase) => {
        try {
          const resolved = await this.resolve(useCase);
          return {
            useCase,
            ready: true,
            model: {
              providerId: resolved.provider.id,
              providerName: resolved.provider.name,
              modelId: resolved.modelConfig.modelId,
              name: resolved.modelConfig.name,
              reasoning: resolved.modelConfig.reasoning,
              input: resolved.modelConfig.input,
            },
          };
        } catch (error) {
          return {
            useCase,
            ready: false,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );
  }

  async resolve(
    useCase: AiUseCase,
    modelOverride?: AiModelRef | null
  ): Promise<ResolvedAiRoute> {
    const { snapshot, runtime } = await this.ensureState();
    const route = snapshot.config.routes[useCase];
    const ref = modelOverride ?? route.model;
    if (!ref) throw new Error(`用途「${useCase}」尚未配置模型`);

    const provider = snapshot.config.providers.find(
      (entry) => entry.id === ref.providerId
    );
    if (!provider) throw new Error(`用途「${useCase}」引用的 Provider 不存在`);
    if (!provider.enabled) {
      throw new Error(`Provider「${provider.name}」已停用`);
    }
    const modelConfig = snapshot.config.models.find(
      (entry) => modelRefKey(entry) === modelRefKey(ref)
    );
    if (!modelConfig) throw new Error(`用途「${useCase}」引用的模型不存在`);
    if (!modelConfig.enabled) {
      throw new Error(`模型「${modelConfig.name}」已停用`);
    }
    const auth = await this.store.authStatus(provider);
    if (!auth.configured) {
      throw new Error(`Provider「${provider.name}」缺少凭据`);
    }
    const piProviderId = runtimeProviderId(provider.id);
    const model = runtime.getModel(piProviderId, modelConfig.modelId);
    if (!model) {
      throw new Error(`模型「${modelConfig.name}」未注册到当前运行时`);
    }
    const contextProfile = snapshot.config.contextProfiles.find(
      (profile) => profile.id === route.contextProfileId
    );
    if (!contextProfile) {
      throw new Error(`用途「${useCase}」引用的上下文配置档不存在`);
    }
    return {
      useCase,
      runtimeProviderId: piProviderId,
      provider,
      modelConfig,
      model,
      thinkingLevel: route.thinkingLevel,
      contextProfile,
      configEtag: snapshot.etag,
    };
  }

  async modelRuntime(): Promise<ModelRuntime> {
    return (await this.ensureState()).runtime;
  }

  invalidate(): void {
    this.state = null;
  }

  private async ensureState(): Promise<RuntimeState> {
    if (this.state) return this.state;
    this.loading ??= this.store
      .load()
      .then((snapshot) => this.buildState(snapshot))
      .then((state) => {
        this.state = state;
        applyNetworkConfig(state.snapshot.config);
        return state;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private async buildState(snapshot: AiConfigSnapshot): Promise<RuntimeState> {
    const runtime = await ModelRuntime.create({
      credentials: this.store.credentials,
      modelsPath: null,
      allowModelNetwork: false,
    });
    for (const provider of snapshot.config.providers) {
      if (!provider.enabled) continue;
      const models = snapshot.config.models.filter(
        (model) => model.providerId === provider.id && model.enabled
      );
      if (!models.length) continue;
      runtime.registerProvider(
        runtimeProviderId(provider.id),
        providerRegistration(provider, models)
      );
    }
    return { snapshot, runtime };
  }
}

export function toPiThinkingLevel(
  level: AiThinkingLevel
): ThinkingLevel | undefined {
  return level === "off" ? undefined : level;
}

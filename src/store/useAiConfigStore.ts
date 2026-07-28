import { create } from "zustand";
import { bridge } from "@/lib/bridge";
import type {
  AiConfigSnapshot,
  AiConfigV1,
  AiCredentialDraft,
  AiProviderConfig,
  AuthStatus,
  DiscoveredModel,
} from "@/shared/ai-config";

interface AiConfigStoreState {
  snapshot: AiConfigSnapshot | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  discoveries: Record<string, DiscoveredModel[]>;
  lastDiscoveredProviderId: string | null;
  load: () => Promise<AiConfigSnapshot>;
  reload: () => Promise<AiConfigSnapshot>;
  save: (config: AiConfigV1) => Promise<AiConfigSnapshot>;
  saveProvider: (
    config: AiConfigV1,
    provider: AiProviderConfig,
    draft: AiCredentialDraft
  ) => Promise<AiConfigSnapshot>;
  saveCredential: (
    provider: AiProviderConfig,
    draft: AiCredentialDraft
  ) => Promise<AuthStatus>;
  deleteCredential: (providerId: string) => Promise<void>;
  discover: (
    provider: AiProviderConfig,
    draft: AiCredentialDraft
  ) => Promise<DiscoveredModel[]>;
  testProvider: (
    provider: AiProviderConfig,
    draft: AiCredentialDraft
  ) => Promise<{ ok: true; message: string }>;
}

function nativeBridge() {
  if (!bridge) throw new Error("AI 配置仅在桌面应用中可用");
  return bridge;
}

function notifyRuntimeChanged() {
  window.dispatchEvent(new Event("mailuo-ai-runtime-changed"));
}

export const useAiConfigStore = create<AiConfigStoreState>((set, get) => ({
  snapshot: null,
  loading: false,
  saving: false,
  error: null,
  discoveries: {},
  lastDiscoveredProviderId: null,

  load: async () => {
    const existing = get().snapshot;
    if (existing) return existing;
    set({ loading: true, error: null });
    try {
      const snapshot = await nativeBridge().getAiConfig();
      set({ snapshot, loading: false });
      return snapshot;
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },

  reload: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await nativeBridge().reloadAiConfig();
      set({ snapshot, loading: false });
      notifyRuntimeChanged();
      return snapshot;
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },

  save: async (config) => {
    set({ saving: true, error: null });
    try {
      const snapshot = await nativeBridge().saveAiConfig(
        config,
        get().snapshot?.etag ?? null
      );
      set({ snapshot, saving: false });
      notifyRuntimeChanged();
      return snapshot;
    } catch (error) {
      set({ saving: false, error: String(error) });
      throw error;
    }
  },

  saveProvider: async (config, provider, draft) => {
    set({ saving: true, error: null });
    try {
      const snapshot = await nativeBridge().saveAiProvider(
        config,
        get().snapshot?.etag ?? null,
        provider,
        draft
      );
      set({ snapshot, saving: false });
      notifyRuntimeChanged();
      return snapshot;
    } catch (error) {
      set({ saving: false, error: String(error) });
      throw error;
    }
  },

  saveCredential: async (provider, draft) => {
    const status = await nativeBridge().saveAiCredential(provider, draft);
    const snapshot = get().snapshot;
    if (snapshot) {
      set({
        snapshot: {
          ...snapshot,
          authStatus: [
            ...snapshot.authStatus.filter(
              (entry) => entry.providerId !== provider.id
            ),
            status,
          ],
        },
      });
    }
    notifyRuntimeChanged();
    return status;
  },

  deleteCredential: async (providerId) => {
    await nativeBridge().deleteAiCredential(providerId);
    const snapshot = get().snapshot;
    if (snapshot) {
      set({
        snapshot: {
          ...snapshot,
          authStatus: snapshot.authStatus.map((status) =>
            status.providerId === providerId
              ? {
                  providerId,
                  configured: false,
                  mode: status.mode,
                  secretHeaders: status.secretHeaders.map((header) => ({
                    name: header.name,
                    configured: false,
                  })),
                }
              : status
          ),
        },
      });
    }
    notifyRuntimeChanged();
  },

  discover: async (provider, draft) => {
    const models = await nativeBridge().discoverAiModels(provider, draft);
    set((state) => ({
      discoveries: { ...state.discoveries, [provider.id]: models },
      lastDiscoveredProviderId: provider.id,
    }));
    return models;
  },
  testProvider: (provider, draft) =>
    nativeBridge().testAiProvider(provider, draft),
}));

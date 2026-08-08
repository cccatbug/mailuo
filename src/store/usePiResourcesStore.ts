import { create } from "zustand";
import { bridge } from "@/lib/bridge";
import type {
  PiResourceProgressEvent,
  PiResourcesSnapshot,
} from "@/shared/pi-resources";

interface PiResourcesStoreState {
  snapshot: PiResourcesSnapshot | null;
  loading: boolean;
  error: string | null;
  progress: PiResourceProgressEvent | null;
  load: () => Promise<PiResourcesSnapshot>;
  refresh: () => Promise<PiResourcesSnapshot>;
  setSnapshot: (snapshot: PiResourcesSnapshot) => void;
  setProgress: (progress: PiResourceProgressEvent | null) => void;
}

function nativeBridge() {
  if (!bridge) throw new Error("资源管理仅在桌面应用中可用");
  return bridge;
}

export const usePiResourcesStore = create<PiResourcesStoreState>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  progress: null,
  load: async () => {
    if (get().snapshot) return get().snapshot!;
    set({ loading: true, error: null });
    try {
      const snapshot = await nativeBridge().listPiResources();
      set({ snapshot, loading: false });
      return snapshot;
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await nativeBridge().refreshPiResources();
      set({ snapshot, loading: false });
      return snapshot;
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  setSnapshot: (snapshot) => set({ snapshot, loading: false, error: null }),
  setProgress: (progress) => set({ progress }),
}));

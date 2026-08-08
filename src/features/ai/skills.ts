import { bridge } from "@/lib/bridge";

export interface SkillInfo {
  name: string;
  description: string;
  content: string;
}

let cache: SkillInfo[] | null = null;

/** 读取由主进程统一发现的启用 Skill；资源配置变化后可主动刷新缓存。 */
export async function getSkills(): Promise<SkillInfo[]> {
  if (cache) return cache;
  cache = (await bridge?.listSkills().catch(() => [])) ?? [];
  return cache;
}

export function clearSkillsCache(): void {
  cache = null;
}

export async function refreshSkills(): Promise<SkillInfo[]> {
  clearSkillsCache();
  return getSkills();
}

if (typeof window !== "undefined") {
  window.addEventListener("mailuo-ai-runtime-changed", clearSkillsCache);
}

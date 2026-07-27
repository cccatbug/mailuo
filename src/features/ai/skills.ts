import { bridge } from "@/lib/bridge";

export interface SkillInfo {
  name: string;
  description: string;
  content: string;
}

let cache: SkillInfo[] | null = null;

/** 解析自 ~/.pi/agent/skills 的 skill 列表（主进程读取，进程内缓存） */
export async function getSkills(): Promise<SkillInfo[]> {
  if (cache) return cache;
  cache = (await bridge?.listSkills().catch(() => [])) ?? [];
  return cache;
}

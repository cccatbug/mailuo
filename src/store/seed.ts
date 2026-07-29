import type { PersistedData, Priority, Project, Status, Task } from "@/types";
import { PROJECT_COLORS } from "@/types";

const uid = () => crypto.randomUUID();

export function seedData(): PersistedData {
  const p1: Project = {
    id: uid(),
    name: "新版官网上线",
    color: PROJECT_COLORS[0],
    createdAt: Date.now() - 86400000 * 6,
  };
  const p2: Project = {
    id: uid(),
    name: "个人 · 读书与写作",
    color: PROJECT_COLORS[1],
    createdAt: Date.now() - 86400000 * 3,
  };

  let seq = 0;
  const mk = (
    title: string,
    status: Status,
    deps: Task[],
    priority: Priority = "normal",
    projectId: string = p1.id,
    tags: string[] = []
  ): Task => ({
    id: uid(),
    projectId,
    title,
    notes: "",
    status,
    priority,
    dueDate: null,
    tags,
    deps: deps.map((d) => d.id),
    createdAt: Date.now() - 86400000 * 5 + seq++ * 3600000,
    completedAt: status === "done" ? Date.now() - 3600000 * seq : null,
  });

  const t1 = mk("旧站内容盘点", "done", [], "normal", p1.id, ["内容"]);
  const t2 = mk("视觉风格定稿", "done", [], "high", p1.id, ["设计"]);
  const t3 = mk("信息架构设计", "doing", [t1], "high", p1.id, ["设计"]);
  const t4 = mk("首页视觉设计", "todo", [t2, t3], "normal", p1.id, ["设计"]);
  const t5 = mk("前端开发", "todo", [t4], "high", p1.id, ["研发"]);
  const t6 = mk("全站文案撰写", "doing", [t3], "normal", p1.id, ["内容"]);
  const t7 = mk("SEO 迁移方案", "todo", [t3], "low", p1.id, ["增长"]);
  const t8 = mk("内容录入与排版", "todo", [t5, t6], "normal", p1.id, ["内容"]);
  const t9 = mk("全站测试", "todo", [t7, t8], "high", p1.id, ["研发"]);
  const t10 = mk("正式上线", "todo", [t9], "high", p1.id);

  const r1 = mk("读完《置身事内》", "doing", [], "normal", p2.id, ["阅读"]);
  const r2 = mk("整理读书笔记", "todo", [r1], "normal", p2.id, ["笔记"]);
  const r3 = mk("写一篇书评", "todo", [r2], "low", p2.id, ["写作"]);

  return {
    version: 2,
    projects: [p1, p2],
    tasks: [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, r1, r2, r3],
  };
}

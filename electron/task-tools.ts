import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { TASK_RUNTIME } from "./task-runtime";

function textResult(value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [
      {
        type: "text" as const,
        text:
          text.length > 40_000
            ? `${text.slice(0, 40_000)}\n…（任务工具输出已截断，请缩小筛选范围）`
            : text,
      },
    ],
    details: undefined,
  };
}

const priority = Type.Union([
  Type.Literal("high"),
  Type.Literal("normal"),
  Type.Literal("low"),
]);

const status = Type.Union([
  Type.Literal("todo"),
  Type.Literal("doing"),
  Type.Literal("done"),
]);

const recurrenceUnit = Type.Union([
  Type.Literal("day"),
  Type.Literal("week"),
  Type.Literal("month"),
]);

const scheduleInput = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("none"),
      Type.Literal("once"),
      Type.Literal("recurring"),
    ], { description: "none=不限期，once=一次性截止，recurring=定期处理" }),
    due: Type.Optional(
      Type.String({ description: "YYYY-MM-DD；once 的截止日 / recurring 的下次处理日" })
    ),
    start: Type.Optional(Type.String({ description: "YYYY-MM-DD 起始日" })),
    unit: Type.Optional(recurrenceUnit),
    interval: Type.Optional(
      Type.Number({ description: "每几个 unit 一次；unit=day interval=2 就是隔天" })
    ),
    weekdays: Type.Optional(
      Type.Array(Type.Number(), { description: "unit=week 时指定星期，1=周一…7=周日" })
    ),
    monthDay: Type.Optional(
      Type.Number({ description: "unit=month 时指定每月第几天，1-31" })
    ),
    until: Type.Optional(Type.String({ description: "YYYY-MM-DD 之后停止重复" })),
  },
  { description: "任务的日期安排" }
);

const trackingInput = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("standard"),
      Type.Literal("progress"),
      Type.Literal("checkin"),
    ]),
    current: Type.Optional(Type.Number({ description: "progress 的当前值" })),
    target: Type.Optional(
      Type.Number({ description: "progress 的目标值 / checkin 的目标次数" })
    ),
    unit: Type.Optional(Type.String({ description: "progress 的单位，如「页」" })),
    cadence: Type.Optional(
      Type.Union([Type.Literal("daily"), Type.Literal("monthly")], {
        description: "checkin 的打卡周期",
      })
    ),
    checkIn: Type.Optional(
      Type.Boolean({ description: "true 时为 checkin 任务登记一次本周期打卡" })
    ),
  },
  { description: "任务的追踪方式" }
);

const taskDraft = Type.Object({
  title: Type.String({ description: "任务标题，简洁具体" }),
  notes: Type.Optional(
    Type.String({ description: "Markdown 备注：加粗目标 + 短列表 + 必要链接" })
  ),
  priority: Type.Optional(priority),
  tags: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
  schedule: Type.Optional(scheduleInput),
  tracking: Type.Optional(trackingInput),
  dependsOn: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "前置任务：可用已有任务的 id 或准确标题，也可用本次同批任务的 title",
    })
  ),
});

export function createTaskTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "task_list",
      label: "查询任务",
      description:
        "按条件列出脉络中的任务。这是获取任务事实的唯一可靠来源——动手改任何任务之前先用它拿到准确的 id 和标题，不要凭对话记忆。",
      promptSnippet: "按状态、标签、日期或关键词查询用户的任务。",
      promptGuidelines: [
        "回答涉及具体任务时先查询，不要根据上下文快照猜测 id。",
        "默认只看当前项目；需要跨项目盘点时把 allProjects 设为 true。",
      ],
      parameters: Type.Object({
        projectId: Type.Optional(
          Type.String({ description: "留空表示当前项目" })
        ),
        allProjects: Type.Optional(
          Type.Boolean({ description: "true 时跨全部项目查询" })
        ),
        status: Type.Optional(
          Type.Union(
            [
              Type.Literal("all"),
              Type.Literal("todo"),
              Type.Literal("doing"),
              Type.Literal("done"),
              Type.Literal("blocked"),
              Type.Literal("overdue"),
              Type.Literal("today"),
              Type.Literal("week"),
            ],
            { description: "blocked=受阻，overdue=已逾期，today=今天要处理，week=一周内" }
          )
        ),
        tags: Type.Optional(Type.Array(Type.String())),
        search: Type.Optional(
          Type.String({ description: "在标题、备注、标签里搜关键词" })
        ),
        limit: Type.Optional(Type.Number({ description: "默认 50，最多 200" })),
        includeNotes: Type.Optional(
          Type.Boolean({ description: "true 时附带备注全文，输出会明显变长" })
        ),
      }),
      async execute(_toolCallId, params) {
        return textResult(
          await TASK_RUNTIME.request("list_tasks", params as Record<string, unknown>)
        );
      },
    }),

    defineTool({
      name: "task_detail",
      label: "任务详情",
      description:
        "读取单个任务的完整信息：备注全文、前置与后续任务、日期安排、进度与打卡记录。",
      promptSnippet: "读取一个任务的完整上下文。",
      parameters: Type.Object({
        task: Type.String({ description: "任务 id 或准确标题" }),
      }),
      async execute(_toolCallId, params) {
        return textResult(await TASK_RUNTIME.request("task_detail", params));
      },
    }),

    defineTool({
      name: "task_create",
      label: "创建任务",
      description:
        "创建一个或多个任务，可同时设定标签、日期安排、追踪方式和依赖关系。一次调用里的任务可以互相依赖（dependsOn 写同批任务的 title）。",
      promptSnippet: "为用户创建任务并接好依赖。",
      promptGuidelines: [
        "为每个任务推断 2-5 个简短中文标签，优先复用项目里已有的标签。",
        "备注写成 Markdown：加粗一句话目标，再用短列表写步骤或验收标准。",
        "用户提到「每天」「隔天」「每周一」这类节奏时，用 schedule.kind=recurring 而不是普通截止日。",
        "recurring 只用于 standard 任务；progress 使用 once 截止日，checkin 使用自身 cadence。",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        projectId: Type.Optional(
          Type.String({ description: "留空表示当前项目" })
        ),
        tasks: Type.Array(taskDraft, { minItems: 1, maxItems: 50 }),
      }),
      async execute(_toolCallId, params) {
        return textResult(await TASK_RUNTIME.request("create_tasks", params));
      },
    }),

    defineTool({
      name: "task_update",
      label: "修改任务",
      description:
        "修改已有任务：标题、状态、优先级、备注、标签、日期安排、进度或打卡。只写要改的字段，其余保持不变。",
      promptSnippet: "修改已有任务的字段。",
      promptGuidelines: [
        "task 用 task_list 返回的 id 最可靠；用标题时必须完全准确。",
        "定期任务标记 done 表示完成本轮，处理日会自动顺延到下一次。",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        updates: Type.Array(
          Type.Object({
            task: Type.String({ description: "任务 id 或准确标题" }),
            title: Type.Optional(Type.String()),
            status: Type.Optional(status),
            priority: Type.Optional(priority),
            notes: Type.Optional(
              Type.String({ description: "覆写备注全文（Markdown）" })
            ),
            appendNotes: Type.Optional(
              Type.String({ description: "追加到备注末尾，不覆盖原有内容" })
            ),
            addTags: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
            removeTags: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
            schedule: Type.Optional(scheduleInput),
            tracking: Type.Optional(trackingInput),
            importance: Type.Optional(
              Type.Number({ description: "重要程度 0-1，用于四象限" })
            ),
            urgency: Type.Optional(
              Type.Number({ description: "紧急程度 0-1，用于四象限" })
            ),
          }),
          { minItems: 1, maxItems: 50 }
        ),
      }),
      async execute(_toolCallId, params) {
        return textResult(await TASK_RUNTIME.request("update_tasks", params));
      },
    }),

    defineTool({
      name: "task_delete",
      label: "删除任务",
      description:
        "删除任务。删除会一并解除别的任务对它的依赖，用户可以在应用里撤销。删之前先确认这确实是用户要删的那些任务。",
      promptSnippet: "删除用户明确要求删除的任务。",
      executionMode: "sequential",
      parameters: Type.Object({
        tasks: Type.Array(Type.String({ description: "任务 id 或准确标题" }), {
          minItems: 1,
          maxItems: 50,
        }),
      }),
      async execute(_toolCallId, params) {
        return textResult(await TASK_RUNTIME.request("delete_tasks", params));
      },
    }),

    defineTool({
      name: "task_link",
      label: "编排依赖",
      description:
        "建立或解除任务之间的前置依赖，用来编织脉络。会自动拒绝形成环的连接。",
      promptSnippet: "调整任务之间的前后置依赖。",
      promptGuidelines: [
        "只在确有先后关系时建立依赖；「相关」不等于「前置」。",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        links: Type.Array(
          Type.Object({
            task: Type.String({ description: "下游任务 id 或准确标题" }),
            dependsOn: Type.String({ description: "前置任务 id 或准确标题" }),
            remove: Type.Optional(
              Type.Boolean({ description: "true 表示解除这条依赖" })
            ),
          }),
          { minItems: 1, maxItems: 50 }
        ),
      }),
      async execute(_toolCallId, params) {
        return textResult(await TASK_RUNTIME.request("link_tasks", params));
      },
    }),

    defineTool({
      name: "project_list",
      label: "项目列表",
      description:
        "列出全部项目及其进度概况，并指出当前正在查看哪个项目。跨项目盘点或需要切换项目时先用它。",
      promptSnippet: "查看用户的项目清单与进度。",
      parameters: Type.Object({
        switchTo: Type.Optional(
          Type.String({ description: "项目 id 或准确名称；传入即切换当前项目" })
        ),
      }),
      async execute(_toolCallId, params) {
        const action = params.switchTo ? "switch_project" : "list_projects";
        return textResult(await TASK_RUNTIME.request(action, params));
      },
    }),
  ];
}

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const mr = await ModelRuntime.create();
const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  noExtensions: true,
  systemPromptOverride: () => "你是测试助手",
});
await loader.reload();

const { session, modelFallbackMessage } = await createAgentSession({
  agentDir: getAgentDir(),
  modelRuntime: mr,
  sessionManager: SessionManager.inMemory(),
  resourceLoader: loader,
  tools: [],
});
console.log("model:", session.model ? `${session.model.provider}/${session.model.id}` : "none");
if (modelFallbackMessage) console.log("fallback:", modelFallbackMessage);

session.subscribe((e: { type: string } & Record<string, unknown>) => {
  const detail =
    e.type === "message_update"
      ? ` ${(e.assistantMessageEvent as { type?: string })?.type}`
      : e.type.startsWith("message_end")
        ? ` ${JSON.stringify((e.message as {errorMessage?:string})?.errorMessage ?? e.message).slice(0, 500)}`
        : "";
  console.log("EVT:", e.type + detail);
});

try {
  await session.prompt("只回复：芝麻开门");
} catch (err) {
  console.log("PROMPT ERROR:", err);
}
session.dispose();
process.exit(0);

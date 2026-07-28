import { AI_RUNTIME, runOneShot } from "../electron/pi";

try {
  const snapshot = await AI_RUNTIME.reload();
  const route = snapshot.config.routes.assistant.model;
  console.log("config:", AI_RUNTIME.store.configPath);
  console.log(
    "assistant model:",
    route ? `${route.providerId}/${route.modelId}` : "not configured"
  );
  console.log(
    await runOneShot(
      "assistant",
      "你是测试助手",
      "只回复：芝麻开门"
    )
  );
} catch (err) {
  console.log("PROMPT ERROR:", err);
}
process.exit(0);

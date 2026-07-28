import { AI_RUNTIME, runOneShot } from "../electron/pi";

try {
  const snapshot = await AI_RUNTIME.reload();
  const route = snapshot.config.routes["notes-polish"].model;
  console.log("config:", AI_RUNTIME.store.configPath);
  console.log(
    "notes-polish model:",
    route ? `${route.providerId}/${route.modelId}` : "not configured"
  );
  console.log(
    await runOneShot(
      "notes-polish",
      "只回复：芝麻开门"
    )
  );
} catch (err) {
  console.log("PROMPT ERROR:", err);
}
process.exit(0);

/** 独立冒烟：使用当前应用配置验证 pi SDK 流式会话。 */
import {
  AI_RUNTIME,
  assistantReset,
  assistantSend,
} from "../electron/pi.ts";

await AI_RUNTIME.reload();

try {
  console.log("== streaming turn ==");
  let text = "";
  let deltas = 0;
  await assistantSend("只回复：一二三", "sdk-smoke", [], {}, null, (event) => {
    if (event.type === "delta" && event.text) {
      text += event.text;
      deltas += 1;
    }
  });
  if (!text.trim() || deltas === 0) {
    throw new Error("流式会话未收到文本增量");
  }
  console.log(`STREAM: ${deltas} deltas, ${text.trim().length} chars`);
} finally {
  assistantReset();
}

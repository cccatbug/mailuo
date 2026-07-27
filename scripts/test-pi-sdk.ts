/** 独立冒烟：验证主进程的 pi SDK 封装（一次性 + 流式多轮） */
import { assistantReset, assistantSend, runOneShot } from "../electron/pi.ts";

const config = { provider: null, model: null, thinking: null, proxy: null };

console.log("== oneshot ==");
const text = await runOneShot(config, "你是测试助手", "只回复：芝麻开门");
console.log("REPLY:", text);

console.log("== streaming turn 1 ==");
let acc1 = "";
await assistantSend(config, "你是测试助手", "只回复：一二三", (e) => {
  if (e.type === "delta" && e.text) acc1 += e.text;
});
console.log("STREAM1:", acc1.trim());

console.log("== streaming turn 2 (memory) ==");
let acc2 = "";
await assistantSend(config, "你是测试助手", "我上一句让你回复什么？", (e) => {
  if (e.type === "delta" && e.text) acc2 += e.text;
});
console.log("STREAM2:", acc2.trim());

assistantReset();
console.log("OK");
process.exit(0);

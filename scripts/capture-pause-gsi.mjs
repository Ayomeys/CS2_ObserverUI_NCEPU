/**
 * 旁路采集暂停 UI 收到的数据，不修改游戏配置或应用状态。
 * 记录应用处理后的 gsi:data，不是 CS2 原始 HTTP 请求。
 * 保留 provider / map / round / phase_countdowns；省略数据库附件 _db。
 * bun scripts/capture-pause-gsi.mjs [分钟数，默认 30]；Ctrl+C 停止。
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { io } from "socket.io-client";

if (process.argv.includes("--help")) {
  console.log("bun scripts/capture-pause-gsi.mjs [分钟数，默认 30]\n记录应用处理后的暂停数据；Ctrl+C 停止。");
  process.exit(0);
}
const minutes = Number(process.argv[2] ?? 30);
if (!Number.isFinite(minutes) || minutes <= 0) {
  console.error("分钟数必须是大于 0 的数字。");
  process.exit(1);
}
const outputDir = join(process.cwd(), "dist", "diagnostics");
mkdirSync(outputDir, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
const output = join(outputDir, "pause-gsi-" + stamp + ".jsonl");
const stream = createWriteStream(output, { flags: "wx" });
const socket = io("http://127.0.0.1:1469", {
  transports: ["websocket"], reconnection: true, timeout: 5000, autoConnect: false,
});
let stopping = false;
let packets = 0;
let events = 0;
let lastPacketAt = 0;
let lastState = "";
let statusTimer;
let endTimer;

function record(event, data) {
  // 不为缺失字段补默认值；保留暂停相关对象中的未知字段。
  const row = { local_time: new Date().toISOString(), event, data };
  stream.write(JSON.stringify(row, (key, value) => key === "_db" ? undefined : value) + "\n");
  if (stream.writableLength > 8 * 1024 * 1024 && !stopping) {
    console.error("写盘积压超过 8 MiB，停止采集，请检查磁盘。");
    stop("write_backlog", 1);
  }
}
stream.on("error", (error) => {
  stopping = true;
  console.error("记录写入失败：" + error.message);
  clearInterval(statusTimer);
  clearTimeout(endTimer);
  socket.removeAllListeners();
  socket.disconnect();
  process.exitCode = 1;
});
socket.on("connect", () => {
  record("connect", { id: socket.id });
  console.log("已连接 1469，等待 demo 的 GSI 数据。");
});
socket.on("disconnect", (reason) => record("disconnect", { reason }));
socket.on("connect_error", (error) => {
  record("connect_error", { message: error.message });
  console.log("连接失败，将自动重试：" + error.message);
});
socket.on("gsi:data", (data) => {
  if (stopping) return;
  packets++;
  lastPacketAt = Date.now();
  record("gsi:data", {
    provider: data?.provider, map: data?.map, round: data?.round,
    phase_countdowns: data?.phase_countdowns,
    received_top_level_keys: Object.keys(data ?? {}),
  });
  const state = {
    phase: data?.phase_countdowns?.phase, round: data?.map?.round,
    ct_remaining: data?.map?.team_ct?.timeouts_remaining,
    t_remaining: data?.map?.team_t?.timeouts_remaining,
  };
  const key = JSON.stringify(state);
  if (key !== lastState) {
    lastState = key;
    console.log("状态变化：" + key);
  }
});
for (const event of ["timeoutStart", "timeoutEnd", "pauseStart", "pauseEnd", "phaseChange", "freezetimeStart", "freezetimeEnd"]) {
  socket.on("gsi:" + event, (...args) => {
    if (stopping) return;
    events++;
    record("gsi:" + event, args);
    console.log("事件：" + event);
  });
}
function stop(reason, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(statusTimer);
  clearTimeout(endTimer);
  socket.disconnect();
  record("capture_end", { reason, packets, events });
  stream.end(() => {
    console.log("采集结束：" + packets + " 包，" + events + " 个事件。\n记录：" + output);
    process.exitCode = exitCode;
  });
}
record("capture_start", {
  source: "processed_socket_gsi", url: "http://127.0.0.1:1469", minutes,
  fields: ["provider", "map", "round", "phase_countdowns"],
  omitted_nested_keys: ["_db"],
});
statusTimer = setInterval(() => {
  console.log("连接=" + (socket.connected ? "是" : "否") + "，累计=" + packets + " 包，距上包=" + (lastPacketAt ? Date.now() - lastPacketAt + "ms" : "尚无数据"));
}, 10000);
endTimer = setTimeout(() => stop("duration_end"), minutes * 60000);
process.once("SIGINT", () => stop("stopped"));
process.once("SIGTERM", () => stop("stopped"));
console.log("暂停采集最长 " + minutes + " 分钟。记录：" + output);
socket.connect();

/**
 * 旁路观察 1469 的 GSI WebSocket。只记录时间、包量和大小，不保存比赛数据。
 *
 * 运行：bun scripts/diagnose-gsi-1469.mjs [分钟数]
 * 默认观察 180 分钟；结果写入 dist/diagnostics/。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { io } from "socket.io-client";

const minutes = Number(process.argv[2] ?? 180);
if (!Number.isFinite(minutes) || minutes <= 0) {
  console.error("分钟数必须是大于 0 的数字，例如：bun scripts/diagnose-gsi-1469.mjs 120");
  process.exit(1);
}

const outputDir = join(process.cwd(), "dist", "diagnostics");
mkdirSync(outputDir, { recursive: true });
function localTime(value) {
  const date = new Date(value);
  const pad = (part, width = 2) => String(part).padStart(width, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

const stamp = localTime(Date.now()).replaceAll(" ", "_").replaceAll(":", "-");
const output = join(outputDir, `gsi-1469-${stamp}.csv`);
appendFileSync(output, "local_time,event,connected,packets,last_packet_age_ms,max_gap_ms,provider_age_last_ms,provider_age_max_ms,sample_bytes,detail\n");

let connected = false;
let packets = 0;
let lastPacketAt = 0;
let maxGap = 0;
let providerAgeLast = null;
let providerAgeMax = null;
let sampleBytes = null;

function row(event, detail = "") {
  const now = Date.now();
  const fields = [
    localTime(now),
    event,
    connected ? 1 : 0,
    packets,
    lastPacketAt ? now - lastPacketAt : "",
    maxGap || "",
    providerAgeLast ?? "",
    providerAgeMax ?? "",
    sampleBytes ?? "",
    `"${String(detail).replaceAll('"', '""')}"`,
  ];
  appendFileSync(output, `${fields.join(",")}\n`);
  if (event === "sample") {
    console.log(
      `${localTime(now)}  包/秒=${packets}  距上包=${lastPacketAt ? now - lastPacketAt : "无"}ms  ` +
      `GSI时间差=${providerAgeLast ?? "无"}ms  连接=${connected ? "是" : "否"}`,
    );
    packets = 0;
    maxGap = 0;
    providerAgeMax = null;
    sampleBytes = null;
  } else {
    console.log(`${localTime(now)}  ${event}: ${detail}`);
  }
}

const socket = io("http://127.0.0.1:1469", {
  transports: ["websocket"],
  reconnection: true,
  timeout: 5000,
});

socket.on("connect", () => {
  connected = true;
  row("connect", socket.id);
});
socket.on("disconnect", (reason) => {
  connected = false;
  row("disconnect", reason);
});
socket.on("connect_error", (error) => row("connect_error", error.message));
socket.on("gsi:data", (data) => {
  const now = Date.now();
  if (lastPacketAt) maxGap = Math.max(maxGap, now - lastPacketAt);
  lastPacketAt = now;
  packets++;

  const providerSeconds = Number(data?.provider?.timestamp);
  providerAgeLast = Number.isFinite(providerSeconds) && providerSeconds > 0
    ? now - providerSeconds * 1000
    : null;
  if (providerAgeLast !== null) {
    providerAgeMax = Math.max(providerAgeMax ?? providerAgeLast, providerAgeLast);
  }

  // 每秒只测一个包的大小，避免诊断工具本身反复序列化完整比赛状态。
  if (sampleBytes === null) sampleBytes = Buffer.byteLength(JSON.stringify(data));
});

const sampleTimer = setInterval(() => row("sample"), 1000);
const endTimer = setTimeout(() => stop("duration_end"), minutes * 60_000);

function stop(reason) {
  clearInterval(sampleTimer);
  clearTimeout(endTimer);
  row(reason);
  socket.removeAllListeners("disconnect");
  socket.disconnect();
  console.log(`诊断记录：${output}`);
  process.exit(0);
}

process.once("SIGINT", () => stop("stopped"));
process.once("SIGTERM", () => stop("stopped"));
console.log(`正在旁路观察 1469，最长 ${minutes} 分钟。记录：${output}`);

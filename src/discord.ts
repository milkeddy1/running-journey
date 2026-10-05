import {
  formatDuration,
  formatKm,
  formatPace,
  formatPaceRange,
  formatPct,
  formatPlanKm,
  formatZoneRange,
} from "./format";
import { activityUrl } from "./strava";
import type { Comparison, Env, Status, StravaActivity, Workout } from "./types";

const COLOR = {
  ok: 0x2ecc71,
  warn: 0xf1c40f,
  fail: 0xe74c3c,
  none: 0x95a5a6,
  error: 0x992d22,
} as const;

const ICON: Record<Status, string> = { ok: "✅", warn: "⚠️", fail: "❌" };

const TYPE_LABEL: Record<NonNullable<Workout["type"]>, string> = {
  easy: "輕鬆跑",
  long: "長跑",
  tempo: "節奏跑",
  interval: "間歇",
  recovery: "恢復跑",
};

const SEP = "────────────────────";

interface Embed {
  title: string;
  url?: string;
  description: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

export function describePlan(w: Workout): string {
  const parts: string[] = [];
  if (w.type === "interval" && w.reps) {
    const d = w.reps.distanceM >= 1000 ? `${w.reps.distanceM / 1000}km` : `${w.reps.distanceM}m`;
    parts.push(`${w.reps.count}×${d}${w.pace ? ` @ ${formatPaceRange(w.pace)} /km` : ""}`);
    if (w.rest) parts.push(`休 ${w.rest}`);
    const wc: string[] = [];
    if (w.warmupKm) wc.push(`熱身 ${formatPlanKm(w.warmupKm)}`);
    if (w.cooldownKm) wc.push(`緩跑 ${formatPlanKm(w.cooldownKm)}`);
    if (wc.length) parts.push(wc.join(" / "));
  } else {
    let main = "";
    if (w.distanceKm) main = formatPlanKm(w.distanceKm);
    else if (w.durationSec) main = formatDuration(w.durationSec);
    if (w.pace) main += `${main ? " @ " : ""}${formatPaceRange(w.pace)} /km`;
    if (main) parts.push(main);
  }
  if (w.hrZones) parts.push(formatZoneRange(w.hrZones));
  return parts.length ? parts.join(" ｜ ") : "（描述欄沒有可解析的課表欄位）";
}

export function fuelTip(w: Workout | undefined, movingTimeSec: number): string {
  const minutes = movingTimeSec / 60;
  if (minutes >= 90) return "長時間訓練：30 分鐘內補充 1–1.2 g/kg 碳水 + 20 g 蛋白質，並留意電解質補充，今天多喝水";
  if (w?.type === "interval" || w?.type === "tempo") return "跑後 30 分鐘內補充碳水 + 蛋白質，幫助肌肉修復";
  if (w?.type === "long") return "長跑日：補足碳水與水分，晚上早點休息";
  if (w?.type === "recovery" || w?.type === "easy") return "輕鬆日：正常飲食即可，記得補水與伸展";
  if (minutes >= 60) return "跑後 30 分鐘內補充碳水 + 蛋白質";
  return "記得補水，輕量伸展放鬆";
}

function zoneSummary(c: Comparison, w: Workout | undefined): string {
  if (!c.zones) return "";
  if (w?.hrZones && c.hr) return `${formatZoneRange(w.hrZones)} 佔 ${formatPct(c.hr.targetPct)}`;
  // 沒有目標區間：列出佔比最高的兩個區間
  const ranked = c.zones.seconds
    .map((s, i) => ({ z: i + 1, pct: s / c.zones!.totalSeconds }))
    .filter((x) => x.pct >= 0.05)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 2);
  return ranked.map((x) => `Z${x.z} ${formatPct(x.pct)}`).join(" · ");
}

export function buildReportEmbed(activity: StravaActivity, workout: Workout | undefined, c: Comparison): Embed {
  const date = activity.start_date_local.slice(0, 10);
  const titleName = workout?.hasFields ? workout.title : activity.name;
  // 行事曆標題本身已寫明型態時（如「節奏跑 10K」）就不再重複加前綴
  const label = workout?.type ? TYPE_LABEL[workout.type] : "";
  const typeLabel = label && !titleName.includes(label) ? `${label} ` : "";
  const title = `🏃 ${typeLabel}${titleName} ｜ ${date}`;

  const pace = activity.distance > 0 ? activity.moving_time / (activity.distance / 1000) : NaN;
  const lines: string[] = [];

  lines.push(SEP);
  lines.push(`📋 課表　${workout?.hasFields ? describePlan(workout) : "今日無排定課表"}`);
  lines.push(`📊 實際　${formatKm(activity.distance)} ｜ ${formatDuration(activity.moving_time)} ｜ ${formatPace(pace)} /km`);

  if (activity.average_heartrate) {
    const parts = [`平均 ${Math.round(activity.average_heartrate)}`];
    if (activity.max_heartrate) parts.push(`最高 ${Math.round(activity.max_heartrate)}`);
    const zs = zoneSummary(c, workout);
    if (zs) parts.push(zs);
    lines.push(`❤️ 心率　${parts.join(" ｜ ")}`);
  } else {
    lines.push("❤️ 心率　無心率資料");
  }
  lines.push(SEP);

  const statuses: string[] = [];
  if (c.distance) statuses.push(`${ICON[c.distance]} 距離`);
  if (c.duration) statuses.push(`${ICON[c.duration]} 時間`);
  if (c.pace) statuses.push(`${ICON[c.pace]} 配速`);
  if (c.intervals) statuses.push(`${ICON[c.intervals.status]} 間歇 ${c.intervals.completed}/${c.intervals.target} 趟`);
  if (c.hr) statuses.push(`${ICON[c.hr.status]} 心率`);
  else if (workout?.hrZones) statuses.push("➖ 心率（無資料）");
  if (statuses.length) lines.push(statuses.join("　"));

  lines.push(`💡 ${fuelTip(workout, activity.moving_time)}`);
  lines.push(`🔗 [Strava 活動連結](${activityUrl(activity.id)})`);

  const fields: Embed["fields"] = [];
  if (c.intervals && c.intervals.laps.length) {
    const rows = c.intervals.laps.map(
      (l) =>
        `${ICON[l.status]} #${l.index}　${Math.round(l.distanceM)} m ｜ ${formatDuration(l.movingTime)} ｜ ${formatPace(l.paceSecPerKm)} /km${l.avgHr ? ` ｜ ❤️ ${Math.round(l.avgHr)}` : ""}`,
    );
    if (c.intervals.completed < c.intervals.target) {
      rows.push(`完成 ${c.intervals.completed} / ${c.intervals.target} 趟`);
    }
    fields.push({ name: "間歇逐趟", value: rows.join("\n").slice(0, 1024) });
  } else if (c.intervals && workout?.reps) {
    fields.push({
      name: "間歇逐趟",
      value: `找不到距離接近 ${workout.reps.distanceM} m 的分段（完成 0 / ${c.intervals.target} 趟）。手錶請用 workout 模式或每趟按 lap。`,
    });
  }

  return {
    title: title.slice(0, 256),
    url: activityUrl(activity.id),
    description: lines.join("\n").slice(0, 4096),
    color: COLOR[c.overall],
    fields,
    footer: { text: "Garmin → Strava → Google Calendar → Discord" },
    timestamp: new Date().toISOString(),
  };
}

export function buildErrorEmbed(activityId: number, error: unknown): Embed {
  const msg = error instanceof Error ? error.message : String(error);
  return {
    title: `⚠️ 活動 ${activityId} 處理失敗`,
    url: activityUrl(activityId),
    description: `\`\`\`\n${msg.slice(0, 1800)}\n\`\`\`\n詳細資訊請看 Cloudflare Workers Logs。`,
    color: COLOR.error,
    timestamp: new Date().toISOString(),
  };
}

export async function postEmbed(env: Env, embed: Embed): Promise<void> {
  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!res.ok) throw new Error(`Discord webhook 失敗 (${res.status}): ${await res.text()}`);
}

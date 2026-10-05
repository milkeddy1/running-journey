import { getGoogleAccessToken } from "./google-auth";
import { parseClock, parsePaceRange, parseZoneRange } from "./format";
import type { CalendarEvent, Env, Workout, WorkoutType } from "./types";

// ---------- 時區 / 日期 ----------

/** Strava 的 start_date_local 字尾是 Z 但其實是本地時間；取前 10 碼即為本地日期 */
export function localDateOf(startDateLocal: string): string {
  return startDateLocal.slice(0, 10);
}

/** 取得某日在指定時區的 UTC 位移字串，如 "+08:00" */
export function tzOffsetString(dateYmd: string, timeZone: string): string {
  const probe = new Date(`${dateYmd}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(probe);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1]! : "+00:00";
}

/** 把 "2026-10-05T06:30:00Z"（本地時間）轉成真正的 epoch ms */
export function localIsoToEpochMs(startDateLocal: string, timeZone: string): number {
  const naked = startDateLocal.replace(/Z$/, "").replace(/[+-]\d{2}:\d{2}$/, "");
  const offset = tzOffsetString(localDateOf(startDateLocal), timeZone);
  return Date.parse(`${naked}${offset}`);
}

// ---------- 查詢 ----------

export async function fetchEventsOnDate(env: Env, dateYmd: string): Promise<CalendarEvent[]> {
  const token = await getGoogleAccessToken(env);
  const offset = tzOffsetString(dateYmd, env.TIMEZONE);
  const next = new Date(`${dateYmd}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextYmd = next.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    timeMin: `${dateYmd}T00:00:00${offset}`,
    timeMax: `${nextYmd}T00:00:00${offset}`,
    singleEvents: "true",
    orderBy: "startTime",
    timeZone: env.TIMEZONE,
    maxResults: "20",
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events?${params}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google Calendar 查詢失敗 (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { items?: CalendarEvent[] };
  return data.items ?? [];
}

// ---------- 課表解析 ----------

const TYPES: Record<string, WorkoutType> = {
  easy: "easy",
  e: "easy",
  輕鬆: "easy",
  輕鬆跑: "easy",
  long: "long",
  lsd: "long",
  長跑: "long",
  tempo: "tempo",
  t: "tempo",
  節奏: "tempo",
  節奏跑: "tempo",
  threshold: "tempo",
  interval: "interval",
  intervals: "interval",
  i: "interval",
  間歇: "interval",
  recovery: "recovery",
  rec: "recovery",
  恢復: "recovery",
  恢復跑: "recovery",
};

/** Google Calendar 在網頁編輯過的描述常帶 HTML，先轉回純文字 */
export function htmlToText(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseKm(text: string): number | undefined {
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(km|k|公里|m|公尺)?/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "m" || unit === "公尺") return n / 1000;
  return n;
}

/** "6x800" / "6 x 800m" / "5×1km" → { count, distanceM } */
export function parseReps(text: string): { count: number; distanceM: number } | undefined {
  const m = text.match(/(\d+)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(km|k|公里|m|公尺)?/i);
  if (!m) return undefined;
  const count = Number(m[1]);
  const n = Number(m[2]);
  const unit = (m[3] ?? "").toLowerCase();
  const distanceM = unit === "km" || unit === "k" || unit === "公里" ? n * 1000 : n;
  if (count <= 0 || distanceM <= 0) return undefined;
  return { count, distanceM };
}

/**
 * 解析描述欄的 `key: value` 課表。無法辨識的行忽略。
 */
export function parseWorkout(description: string | undefined, title = ""): Workout {
  const w: Workout = { title: title.trim() || "訓練", hasFields: false };
  if (!description) return w;

  for (const rawLine of htmlToText(description).split(/\r?\n/)) {
    const m = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_ ]*?)\s*[:：]\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase().replace(/\s+/g, "_");
    const value = m[2]!;
    let hit = true;

    switch (key) {
      case "type": {
        const t = TYPES[value.trim().toLowerCase()];
        if (t) w.type = t;
        else hit = false;
        break;
      }
      case "distance":
      case "dist": {
        const km = parseKm(value);
        if (km !== undefined) w.distanceKm = km;
        else hit = false;
        break;
      }
      case "duration":
      case "time": {
        const s = parseClock(value);
        if (s !== null) w.durationSec = s;
        else hit = false;
        break;
      }
      case "pace": {
        const r = parsePaceRange(value);
        if (r) w.pace = r;
        else hit = false;
        break;
      }
      case "hr_zone":
      case "hr":
      case "zone": {
        const z = parseZoneRange(value);
        if (z) w.hrZones = z;
        else hit = false;
        break;
      }
      case "reps": {
        const r = parseReps(value);
        if (r) w.reps = r;
        else hit = false;
        break;
      }
      case "rest":
      case "recovery":
        w.rest = value;
        break;
      case "warmup":
      case "wu": {
        const km = parseKm(value);
        if (km !== undefined) w.warmupKm = km;
        else hit = false;
        break;
      }
      case "cooldown":
      case "cd": {
        const km = parseKm(value);
        if (km !== undefined) w.cooldownKm = km;
        else hit = false;
        break;
      }
      default:
        hit = false;
    }
    if (hit) w.hasFields = true;
  }
  return w;
}

// ---------- 多筆課表挑選 ----------

function eventStartMs(ev: CalendarEvent): number | undefined {
  if (ev.start.dateTime) return Date.parse(ev.start.dateTime);
  return undefined; // 全天活動
}

/**
 * 當天有多個課表時，挑開始時間最接近活動開始時間的那一筆。
 * 有解析出欄位的優先；全天事件視為「距離最遠」但仍可被選中。
 */
export function pickWorkout(events: CalendarEvent[], activityStartMs: number): Workout | undefined {
  if (events.length === 0) return undefined;
  const parsed = events.map((ev) => {
    const w = parseWorkout(ev.description, ev.summary);
    w.startMs = eventStartMs(ev);
    return w;
  });
  const candidates = parsed.some((w) => w.hasFields) ? parsed.filter((w) => w.hasFields) : parsed;
  candidates.sort((a, b) => {
    const da = a.startMs === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(a.startMs - activityStartMs);
    const db = b.startMs === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(b.startMs - activityStartMs);
    return da - db;
  });
  return candidates[0];
}

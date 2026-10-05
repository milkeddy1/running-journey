// ---------- Worker 環境 ----------

export interface Env {
  STATE: KVNamespace;

  // secrets
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_VERIFY_TOKEN: string;
  GOOGLE_SA_EMAIL: string;
  GOOGLE_SA_PRIVATE_KEY: string;
  DISCORD_WEBHOOK_URL: string;

  // vars
  STRAVA_ATHLETE_ID: string;
  STRAVA_SUBSCRIPTION_ID: string;
  GOOGLE_CALENDAR_ID: string;
  TIMEZONE: string;
  LTHR: string;
}

// ---------- Strava ----------

export interface StravaWebhookEvent {
  object_type: "activity" | "athlete";
  object_id: number;
  aspect_type: "create" | "update" | "delete";
  owner_id: number;
  subscription_id: number;
  event_time: number;
  updates?: Record<string, unknown>;
}

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  expires_in: number;
}

export interface StravaActivity {
  id: number;
  name: string;
  sport_type: string;
  type?: string;
  distance: number; // m
  moving_time: number; // s
  elapsed_time: number; // s
  average_speed: number; // m/s
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  has_heartrate?: boolean;
  start_date: string; // UTC ISO
  start_date_local: string; // 本地時間，但字尾仍是 Z
  timezone?: string;
  total_elevation_gain?: number;
}

export interface StravaLap {
  id: number;
  name: string;
  lap_index: number;
  distance: number; // m
  moving_time: number; // s
  elapsed_time: number; // s
  average_speed: number; // m/s
  average_heartrate?: number;
  max_heartrate?: number;
}

export interface StravaStreams {
  heartrate?: { data: number[] };
  time?: { data: number[] };
  distance?: { data: number[] };
}

// ---------- Google Calendar ----------

export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
}

// ---------- 課表 ----------

export type WorkoutType = "easy" | "long" | "tempo" | "interval" | "recovery";

export interface PaceRange {
  /** 較快的配速（秒/公里，數值較小） */
  min: number;
  /** 較慢的配速（秒/公里，數值較大） */
  max: number;
}

export interface Workout {
  title: string;
  startMs?: number;
  type?: WorkoutType;
  distanceKm?: number;
  durationSec?: number;
  pace?: PaceRange;
  /** [低區, 高區]，例如 Z3-Z4 → [3, 4] */
  hrZones?: [number, number];
  reps?: { count: number; distanceM: number };
  rest?: string;
  warmupKm?: number;
  cooldownKm?: number;
  /** 有成功解析出至少一個欄位 */
  hasFields: boolean;
}

// ---------- 對照 ----------

export type Status = "ok" | "warn" | "fail";

export interface ZoneDistribution {
  /** index 0 = Z1 … index 4 = Z5，單位：秒 */
  seconds: [number, number, number, number, number];
  totalSeconds: number;
}

export interface LapResult {
  index: number;
  distanceM: number;
  movingTime: number;
  paceSecPerKm: number;
  avgHr?: number;
  status: Status;
}

export interface IntervalResult {
  completed: number;
  target: number;
  laps: LapResult[];
  status: Status;
}

export interface Comparison {
  distance?: Status;
  duration?: Status;
  pace?: Status;
  hr?: { status: Status; targetPct: number };
  intervals?: IntervalResult;
  zones?: ZoneDistribution;
  overall: Status | "none";
}

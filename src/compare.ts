import { paceFromDistance } from "./format";
import type {
  Comparison,
  IntervalResult,
  LapResult,
  Status,
  StravaActivity,
  StravaLap,
  StravaStreams,
  Workout,
  ZoneDistribution,
} from "./types";

// ---------- 門檻（可在此調整） ----------

export const THRESHOLDS = {
  distance: { ok: 0.05, warn: 0.15 },
  duration: { ok: 0.05, warn: 0.15 },
  paceToleranceSec: 10,
  intervalPaceToleranceSec: 5,
  hr: { ok: 0.7, warn: 0.5 },
  /** 間歇 lap 距離與單趟目標的容許誤差 */
  lapDistanceTolerance: 0.1,
  /** 心率 stream 相鄰取樣超過此秒數視為暫停，不計入 */
  maxSampleGapSec: 10,
};

/** 以 LTHR 百分比定義的區間下限：Z1 <85%、Z2 85–89%、Z3 90–94%、Z4 95–99%、Z5 ≥100% */
export const ZONE_LOWER_BOUNDS = [0, 0.85, 0.9, 0.95, 1.0] as const;

// ---------- 基本比對 ----------

function ratioStatus(actual: number, target: number, t: { ok: number; warn: number }): Status {
  const dev = Math.abs(actual - target) / target;
  if (dev <= t.ok) return "ok";
  if (dev <= t.warn) return "warn";
  return "fail";
}

export function compareDistance(actualKm: number, targetKm: number): Status {
  return ratioStatus(actualKm, targetKm, THRESHOLDS.distance);
}

export function compareDuration(actualSec: number, targetSec: number): Status {
  return ratioStatus(actualSec, targetSec, THRESHOLDS.duration);
}

/** 配速偏離區間的秒數（在區間內為 0；正數 = 偏慢，負數 = 偏快） */
export function paceDeviation(actual: number, range: { min: number; max: number }): number {
  if (actual < range.min) return actual - range.min;
  if (actual > range.max) return actual - range.max;
  return 0;
}

export function comparePace(
  actual: number,
  range: { min: number; max: number },
  type: Workout["type"],
  toleranceSec = THRESHOLDS.paceToleranceSec,
): Status {
  const dev = paceDeviation(actual, range);
  if (type === "easy" || type === "recovery") {
    // 只檢查「不快於區間下限」；跑太快一律 ⚠️，跑慢沒關係
    return dev < 0 ? "warn" : "ok";
  }
  if (dev === 0) return "ok";
  return Math.abs(dev) <= toleranceSec ? "warn" : "fail";
}

// ---------- 心率區間 ----------

export function zoneOf(hr: number, lthr: number): number {
  const pct = hr / lthr;
  let zone = 1;
  for (let i = 1; i < ZONE_LOWER_BOUNDS.length; i++) {
    if (pct >= ZONE_LOWER_BOUNDS[i]!) zone = i + 1;
  }
  return zone;
}

/** 用 time stream 的差值加權，計算每個區間的秒數 */
export function zoneDistribution(streams: StravaStreams, lthr: number): ZoneDistribution | undefined {
  const hr = streams.heartrate?.data;
  const time = streams.time?.data;
  if (!hr || hr.length === 0 || !(lthr > 0)) return undefined;

  const seconds: ZoneDistribution["seconds"] = [0, 0, 0, 0, 0];
  let total = 0;
  for (let i = 0; i < hr.length; i++) {
    const h = hr[i];
    if (h === undefined || h <= 0) continue;
    let dt = 1;
    if (time && time.length === hr.length) {
      const next = time[i + 1];
      const cur = time[i];
      if (next !== undefined && cur !== undefined) dt = next - cur;
      else if (i > 0) {
        const prev = time[i - 1];
        dt = cur !== undefined && prev !== undefined ? cur - prev : 1;
      }
    }
    if (!(dt > 0) || dt > THRESHOLDS.maxSampleGapSec) dt = Math.min(Math.max(dt, 0), 1);
    const z = zoneOf(h, lthr);
    seconds[z - 1]! += dt;
    total += dt;
  }
  if (total === 0) return undefined;
  return { seconds, totalSeconds: total };
}

export function zoneShare(dist: ZoneDistribution, zones: [number, number]): number {
  let s = 0;
  for (let z = zones[0]; z <= zones[1]; z++) s += dist.seconds[z - 1] ?? 0;
  return s / dist.totalSeconds;
}

export function compareHr(share: number): Status {
  if (share >= THRESHOLDS.hr.ok) return "ok";
  if (share >= THRESHOLDS.hr.warn) return "warn";
  return "fail";
}

// ---------- 間歇 ----------

export function compareIntervals(laps: StravaLap[], workout: Workout): IntervalResult | undefined {
  const reps = workout.reps;
  if (!reps) return undefined;
  const tol = reps.distanceM * THRESHOLDS.lapDistanceTolerance;
  const matched = laps.filter((l) => Math.abs(l.distance - reps.distanceM) <= tol);

  const results: LapResult[] = matched.map((l, i) => {
    const pace = paceFromDistance(l.distance, l.moving_time);
    let status: Status = "ok";
    if (workout.pace) {
      const dev = Math.abs(paceDeviation(pace, workout.pace));
      status = dev === 0 ? "ok" : dev <= THRESHOLDS.intervalPaceToleranceSec ? "warn" : "fail";
    }
    return {
      index: i + 1,
      distanceM: l.distance,
      movingTime: l.moving_time,
      paceSecPerKm: pace,
      avgHr: l.average_heartrate,
      status,
    };
  });

  let status: Status = worst(results.map((r) => r.status)) ?? "ok";
  if (results.length < reps.count) {
    // 趟數不足：缺一兩趟算 ⚠️，缺更多算 ❌
    const missing = reps.count - results.length;
    status = worst([status, missing <= Math.max(1, Math.floor(reps.count * 0.2)) ? "warn" : "fail"])!;
  }
  return { completed: results.length, target: reps.count, laps: results, status };
}

// ---------- 彙整 ----------

const RANK: Record<Status, number> = { ok: 0, warn: 1, fail: 2 };

export function worst(statuses: (Status | undefined)[]): Status | undefined {
  let w: Status | undefined;
  for (const s of statuses) {
    if (!s) continue;
    if (!w || RANK[s] > RANK[w]) w = s;
  }
  return w;
}

export interface CompareInput {
  activity: StravaActivity;
  laps: StravaLap[];
  streams: StravaStreams;
  workout?: Workout;
  lthr?: number;
}

export function compare({ activity, laps, streams, workout, lthr }: CompareInput): Comparison {
  const result: Comparison = { overall: "none" };
  result.zones = lthr ? zoneDistribution(streams, lthr) : undefined;

  if (!workout || !workout.hasFields) return result;

  const actualKm = activity.distance / 1000;
  const actualPace = paceFromDistance(activity.distance, activity.moving_time);

  if (workout.distanceKm) result.distance = compareDistance(actualKm, workout.distanceKm);
  else if (workout.durationSec) result.duration = compareDuration(activity.moving_time, workout.durationSec);

  // 間歇課表的整體配速沒有意義，改以逐趟比對
  if (workout.type === "interval") {
    result.intervals = compareIntervals(laps, workout);
  } else if (workout.pace && Number.isFinite(actualPace)) {
    result.pace = comparePace(actualPace, workout.pace, workout.type);
  }

  if (workout.hrZones && result.zones) {
    const share = zoneShare(result.zones, workout.hrZones);
    result.hr = { status: compareHr(share), targetPct: share };
  }

  result.overall =
    worst([result.distance, result.duration, result.pace, result.hr?.status, result.intervals?.status]) ?? "none";
  return result;
}

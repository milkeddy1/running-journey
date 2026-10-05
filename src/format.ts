import type { PaceRange } from "./types";

const pad2 = (n: number) => n.toString().padStart(2, "0");

/** 秒/公里 → "m:ss" */
export function formatPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return "--:--";
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

export function formatPaceRange(r: PaceRange): string {
  return r.min === r.max ? formatPace(r.min) : `${formatPace(r.min)}–${formatPace(r.max)}`;
}

/** 秒 → "m:ss" 或 "h:mm:ss" */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "--:--";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** 公尺 → "10.12 km" */
export function formatKm(meters: number, digits = 2): string {
  return `${(meters / 1000).toFixed(digits)} km`;
}

/** 公里數（課表）→ "10 km" / "2.5 km" */
export function formatPlanKm(km: number): string {
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

/** m/s → 秒/公里 */
export function paceFromSpeed(metersPerSecond: number): number {
  return metersPerSecond > 0 ? 1000 / metersPerSecond : NaN;
}

/** 由距離與時間直接算配速，避免 average_speed 四捨五入誤差 */
export function paceFromDistance(meters: number, seconds: number): number {
  return meters > 0 ? seconds / (meters / 1000) : NaN;
}

/** "4:50" / "1:02:30" / "50" → 秒；無法解析回 null */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(":").map((p) => p.trim());
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.length === 1) return nums[0]!;
  if (nums.length === 2) return nums[0]! * 60 + nums[1]!;
  return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
}

/** "4:50-5:00" / "4:50–5:00" / "4:50~5:00" / "4:50" → PaceRange（秒/公里） */
export function parsePaceRange(text: string): PaceRange | null {
  const cleaned = text.replace(/\/\s*km/gi, "").replace(/min/gi, "").trim();
  const parts = cleaned.split(/\s*[-–~～到]\s*/).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;
  const a = parseClock(parts[0]!);
  if (a === null) return null;
  const b = parts.length === 2 ? parseClock(parts[1]!) : a;
  if (b === null) return null;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** "Z2" / "Z3-Z4" / "z3–z4" / "3-4" → [3, 4] */
export function parseZoneRange(text: string): [number, number] | null {
  const m = text.trim().match(/^z?\s*([1-5])\s*(?:[-–~～到]\s*z?\s*([1-5]))?$/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return [Math.min(a, b), Math.max(a, b)];
}

export function formatZoneRange(z: [number, number]): string {
  return z[0] === z[1] ? `Z${z[0]}` : `Z${z[0]}–Z${z[1]}`;
}

export function formatPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

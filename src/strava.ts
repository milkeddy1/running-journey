import type { Env, StravaActivity, StravaLap, StravaStreams, StravaTokenResponse } from "./types";

const API = "https://www.strava.com/api/v3";
const KEY_REFRESH = "strava:refresh_token";
const KEY_ACCESS = "strava:access_token";
/** access token 到期前多少秒就提前換新 */
const SKEW_SEC = 120;

interface CachedToken {
  token: string;
  expires_at: number; // epoch seconds
}

export class StravaError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "StravaError";
  }
}

export async function getStravaAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = await env.STATE.get<CachedToken>(KEY_ACCESS, "json");
  if (cached && cached.expires_at - SKEW_SEC > now) return cached.token;

  const refreshToken = await env.STATE.get(KEY_REFRESH);
  if (!refreshToken) {
    throw new Error(`KV 缺少 ${KEY_REFRESH}，請先依 README 寫入第一組 refresh token`);
  }

  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new StravaError(`Strava token 換發失敗 (${res.status}): ${await res.text()}`, res.status);
  }
  const data = (await res.json()) as StravaTokenResponse;

  // refresh token 可能輪替，一定要寫回，否則下次就換不到了
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await env.STATE.put(KEY_REFRESH, data.refresh_token);
  }
  const ttl = Math.max(60, data.expires_at - now);
  await env.STATE.put(KEY_ACCESS, JSON.stringify({ token: data.access_token, expires_at: data.expires_at }), {
    expirationTtl: ttl,
  });
  return data.access_token;
}

async function stravaGet<T>(env: Env, path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new StravaError(`Strava GET ${path} 失敗 (${res.status}): ${await res.text()}`, res.status);
  }
  return (await res.json()) as T;
}

export function fetchActivity(env: Env, token: string, id: number): Promise<StravaActivity> {
  return stravaGet<StravaActivity>(env, `/activities/${id}`, token);
}

export async function fetchLaps(env: Env, token: string, id: number): Promise<StravaLap[]> {
  try {
    return await stravaGet<StravaLap[]>(env, `/activities/${id}/laps`, token);
  } catch (e) {
    if (e instanceof StravaError && e.status === 404) return [];
    throw e;
  }
}

export async function fetchStreams(env: Env, token: string, id: number): Promise<StravaStreams> {
  try {
    return await stravaGet<StravaStreams>(env, `/activities/${id}/streams?keys=heartrate,time&key_by_type=true`, token);
  } catch (e) {
    // 沒有任何 stream（例如手動建立的活動）會回 404
    if (e instanceof StravaError && e.status === 404) return {};
    throw e;
  }
}

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

export function isRun(activity: StravaActivity): boolean {
  return RUN_TYPES.has(activity.sport_type ?? activity.type ?? "");
}

export function activityUrl(id: number): string {
  return `https://www.strava.com/activities/${id}`;
}

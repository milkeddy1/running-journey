import { fetchEventsOnDate, localDateOf, localIsoToEpochMs, pickWorkout } from "./calendar";
import { compare } from "./compare";
import { buildErrorEmbed, buildReportEmbed, postEmbed } from "./discord";
import { fetchActivity, fetchLaps, fetchStreams, getStravaAccessToken, isRun } from "./strava";
import type { Env, StravaStreams, Workout } from "./types";

const PROCESSED_TTL_SEC = 7 * 24 * 3600;

export async function runPipeline(activityId: number, env: Env): Promise<void> {
  const processedKey = `processed:${activityId}`;
  try {
    // 0. 去重
    if (await env.STATE.get(processedKey)) {
      console.log(`skip: activity ${activityId} already processed`);
      return;
    }

    // 1. Strava
    const token = await getStravaAccessToken(env);
    const activity = await fetchActivity(env, token, activityId);
    if (!isRun(activity)) {
      console.log(`skip: activity ${activityId} sport_type=${activity.sport_type}`);
      await env.STATE.put(processedKey, "1", { expirationTtl: PROCESSED_TTL_SEC });
      return;
    }
    const [laps, streams] = await Promise.all([
      fetchLaps(env, token, activityId),
      activity.has_heartrate === false ? Promise.resolve<StravaStreams>({}) : fetchStreams(env, token, activityId),
    ]);

    // 2. Google Calendar（失敗不應讓整筆推播掛掉，改為「無課表」並記錄）
    let workout: Workout | undefined;
    let calendarError: string | undefined;
    if (env.GOOGLE_CALENDAR_ID && env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY) {
      try {
        const date = localDateOf(activity.start_date_local);
        const events = await fetchEventsOnDate(env, date);
        workout = pickWorkout(events, localIsoToEpochMs(activity.start_date_local, env.TIMEZONE));
      } catch (e) {
        calendarError = e instanceof Error ? e.message : String(e);
        console.error("calendar error", calendarError);
      }
    }

    // 3. 對照
    const lthr = Number(env.LTHR);
    const comparison = compare({
      activity,
      laps,
      streams,
      workout,
      lthr: Number.isFinite(lthr) && lthr > 0 ? lthr : undefined,
    });

    // 4. Discord
    const embed = buildReportEmbed(activity, workout, comparison);
    if (calendarError) embed.description += `\n⚠️ 行事曆讀取失敗：${calendarError.slice(0, 200)}`;
    await postEmbed(env, embed);

    // 5. 標記已處理
    await env.STATE.put(processedKey, "1", { expirationTtl: PROCESSED_TTL_SEC });
    console.log(`done: activity ${activityId} overall=${comparison.overall}`);
  } catch (error) {
    console.error(`pipeline failed for activity ${activityId}`, error);
    try {
      await postEmbed(env, buildErrorEmbed(activityId, error));
    } catch (e) {
      console.error("failed to post error to Discord", e);
    }
  }
}

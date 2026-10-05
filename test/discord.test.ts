import { describe, expect, it } from "vitest";
import { parseWorkout } from "../src/calendar";
import { compare } from "../src/compare";
import { buildReportEmbed, describePlan, fuelTip } from "../src/discord";
import type { StravaActivity } from "../src/types";

const activity: StravaActivity = {
  id: 123,
  name: "Morning Run",
  sport_type: "Run",
  distance: 10120,
  moving_time: 2961,
  elapsed_time: 3000,
  average_speed: 10120 / 2961,
  average_heartrate: 162,
  max_heartrate: 178,
  start_date: "2026-10-04T22:30:00Z",
  start_date_local: "2026-10-05T06:30:00Z",
};

describe("discord embed", () => {
  it("describes plans", () => {
    expect(describePlan(parseWorkout("type: tempo\ndistance: 10\npace: 4:50-5:00\nhr_zone: Z3-Z4"))).toBe(
      "10 km @ 4:50–5:00 /km ｜ Z3–Z4",
    );
    expect(
      describePlan(parseWorkout("type: interval\nwarmup: 2\nreps: 6x800\npace: 3:50-4:00\nrest: 2:00 jog\ncooldown: 2")),
    ).toBe("6×800m @ 3:50–4:00 /km ｜ 休 2:00 jog ｜ 熱身 2 km / 緩跑 2 km");
  });

  it("builds a green report with the expected lines", () => {
    const workout = parseWorkout("type: tempo\ndistance: 10\npace: 4:50-5:00\nhr_zone: Z3-Z4", "節奏跑 10K");
    const hr = Array.from({ length: 100 }, (_, i) => (i < 81 ? 160 : 145));
    const c = compare({ activity, laps: [], streams: { heartrate: { data: hr }, time: { data: hr.map((_, i) => i) } }, workout, lthr: 170 });
    const e = buildReportEmbed(activity, workout, c);
    expect(e.title).toBe("🏃 節奏跑 10K ｜ 2026-10-05");
    expect(e.color).toBe(0x2ecc71);
    expect(e.description).toContain("📋 課表　10 km @ 4:50–5:00 /km ｜ Z3–Z4");
    expect(e.description).toContain("📊 實際　10.12 km ｜ 49:21 ｜ 4:53 /km");
    expect(e.description).toContain("❤️ 心率　平均 162 ｜ 最高 178 ｜ Z3–Z4 佔 81%");
    expect(e.description).toContain("✅ 距離　✅ 配速　✅ 心率");
    expect(e.url).toBe("https://www.strava.com/activities/123");
  });

  it("prefixes the type when the title does not mention it", () => {
    const workout = parseWorkout("type: tempo\ndistance: 10", "週二主課");
    const e = buildReportEmbed(activity, workout, compare({ activity, laps: [], streams: {}, workout }));
    expect(e.title).toBe("🏃 節奏跑 週二主課 ｜ 2026-10-05");
  });

  it("is grey with no plan", () => {
    const c = compare({ activity, laps: [], streams: {} });
    const e = buildReportEmbed(activity, undefined, c);
    expect(e.color).toBe(0x95a5a6);
    expect(e.description).toContain("今日無排定課表");
    expect(e.title).toContain("Morning Run");
  });

  it("gives a stronger fuel tip for long sessions", () => {
    expect(fuelTip(parseWorkout("type: long"), 95 * 60)).toMatch(/長時間/);
    expect(fuelTip(parseWorkout("type: easy"), 40 * 60)).toMatch(/輕鬆/);
  });
});

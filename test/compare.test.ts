import { describe, expect, it } from "vitest";
import {
  compare,
  compareDistance,
  compareHr,
  compareIntervals,
  comparePace,
  zoneDistribution,
  zoneOf,
  zoneShare,
} from "../src/compare";
import { parseWorkout } from "../src/calendar";
import type { StravaActivity, StravaLap } from "../src/types";

const baseActivity: StravaActivity = {
  id: 1,
  name: "Morning Run",
  sport_type: "Run",
  distance: 10120,
  moving_time: 2961,
  elapsed_time: 3000,
  average_speed: 10120 / 2961,
  average_heartrate: 162,
  max_heartrate: 178,
  has_heartrate: true,
  start_date: "2026-10-04T22:30:00Z",
  start_date_local: "2026-10-05T06:30:00Z",
};

describe("distance", () => {
  it("applies ±5% / ±15% bands", () => {
    expect(compareDistance(10.12, 10)).toBe("ok");
    expect(compareDistance(9.0, 10)).toBe("warn");
    expect(compareDistance(8.0, 10)).toBe("fail");
    expect(compareDistance(11.6, 10)).toBe("fail");
  });
});

describe("pace", () => {
  const range = { min: 290, max: 300 };
  it("tempo: in range / ≤10s / >10s", () => {
    expect(comparePace(293, range, "tempo")).toBe("ok");
    expect(comparePace(308, range, "tempo")).toBe("warn");
    expect(comparePace(282, range, "tempo")).toBe("warn");
    expect(comparePace(315, range, "tempo")).toBe("fail");
  });
  it("easy: only flags running too fast", () => {
    expect(comparePace(330, { min: 330, max: 360 }, "easy")).toBe("ok");
    expect(comparePace(400, { min: 330, max: 360 }, "easy")).toBe("ok");
    expect(comparePace(300, { min: 330, max: 360 }, "easy")).toBe("warn");
    expect(comparePace(300, { min: 330, max: 360 }, "recovery")).toBe("warn");
  });
});

describe("heart rate zones", () => {
  const lthr = 170;
  it("maps HR to zones by LTHR percentage", () => {
    expect(zoneOf(140, lthr)).toBe(1); // 82%
    expect(zoneOf(148, lthr)).toBe(2); // 87%
    expect(zoneOf(155, lthr)).toBe(3); // 91%
    expect(zoneOf(165, lthr)).toBe(4); // 97%
    expect(zoneOf(172, lthr)).toBe(5);
  });

  it("weights samples by time deltas and ignores long gaps", () => {
    const dist = zoneDistribution(
      { heartrate: { data: [155, 155, 165, 140] }, time: { data: [0, 5, 10, 300] } },
      lthr,
    );
    // sample 0: 5s Z3, sample 1: 5s Z3, sample 2: 290s gap → clamped to 1s Z4, last: dt=prev(290)→clamped 1s Z1
    expect(dist?.seconds).toEqual([1, 0, 10, 1, 0]);
    expect(zoneShare(dist!, [3, 4])).toBeCloseTo(11 / 12);
  });

  it("returns undefined without HR data", () => {
    expect(zoneDistribution({}, lthr)).toBeUndefined();
  });

  it("applies 70% / 50% bands", () => {
    expect(compareHr(0.81)).toBe("ok");
    expect(compareHr(0.6)).toBe("warn");
    expect(compareHr(0.4)).toBe("fail");
  });
});

describe("intervals", () => {
  const lap = (distance: number, moving_time: number, i: number): StravaLap => ({
    id: i,
    name: `Lap ${i}`,
    lap_index: i,
    distance,
    moving_time,
    elapsed_time: moving_time,
    average_speed: distance / moving_time,
  });
  const workout = parseWorkout("type: interval\nreps: 4x800\npace: 3:50-4:00\nrest: 2:00 jog");

  it("matches rep laps by distance and grades each by pace", () => {
    const laps = [
      lap(2000, 720, 1), // warmup
      lap(800, 188, 2), // 3:55 ok
      lap(400, 150, 3), // rest
      lap(800, 196, 4), // 4:05 warn (+5s)
      lap(400, 150, 5),
      lap(805, 205, 6), // 4:15 fail
      lap(400, 150, 7),
      lap(798, 180, 8), // 3:46 warn (-4s)
      lap(2000, 720, 9), // cooldown
    ];
    const r = compareIntervals(laps, workout)!;
    expect(r.completed).toBe(4);
    expect(r.target).toBe(4);
    expect(r.laps.map((l) => l.status)).toEqual(["ok", "warn", "fail", "warn"]);
    expect(r.status).toBe("fail");
  });

  it("flags missing reps", () => {
    const laps = [lap(800, 188, 1), lap(800, 188, 2), lap(800, 188, 3)];
    const r = compareIntervals(laps, workout)!;
    expect(r.completed).toBe(3);
    expect(r.status).toBe("warn");
    const r2 = compareIntervals([lap(800, 188, 1)], workout)!;
    expect(r2.status).toBe("fail");
  });
});

describe("compare (end to end)", () => {
  it("produces an all-green tempo report", () => {
    const workout = parseWorkout("type: tempo\ndistance: 10\npace: 4:50-5:00\nhr_zone: Z3-Z4", "節奏跑 10K");
    const hr = Array.from({ length: 100 }, (_, i) => (i < 81 ? 160 : 145));
    const time = hr.map((_, i) => i);
    const c = compare({ activity: baseActivity, laps: [], streams: { heartrate: { data: hr }, time: { data: time } }, workout, lthr: 170 });
    expect(c.distance).toBe("ok");
    expect(c.pace).toBe("ok");
    expect(c.hr?.status).toBe("ok");
    expect(c.hr?.targetPct).toBeCloseTo(0.81, 1);
    expect(c.overall).toBe("ok");
  });

  it("is 'none' without a workout but still computes zones", () => {
    const c = compare({ activity: baseActivity, laps: [], streams: { heartrate: { data: [150, 150] }, time: { data: [0, 1] } }, lthr: 170 });
    expect(c.overall).toBe("none");
    expect(c.zones).toBeDefined();
  });

  it("skips HR comparison when there is no stream", () => {
    const workout = parseWorkout("type: tempo\ndistance: 10\nhr_zone: Z3");
    const c = compare({ activity: baseActivity, laps: [], streams: {}, workout, lthr: 170 });
    expect(c.hr).toBeUndefined();
    expect(c.distance).toBe("ok");
    expect(c.overall).toBe("ok");
  });

  it("uses duration when distance is absent", () => {
    const workout = parseWorkout("type: long\nduration: 50:00");
    const c = compare({ activity: baseActivity, laps: [], streams: {}, workout });
    expect(c.duration).toBe("ok");
    expect(c.distance).toBeUndefined();
  });
});

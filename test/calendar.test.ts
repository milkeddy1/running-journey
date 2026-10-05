import { describe, expect, it } from "vitest";
import { localIsoToEpochMs, parseReps, parseWorkout, pickWorkout, tzOffsetString } from "../src/calendar";
import type { CalendarEvent } from "../src/types";

describe("parseWorkout", () => {
  it("parses a tempo workout", () => {
    const w = parseWorkout("type: tempo\ndistance: 10\npace: 4:50-5:00\nhr_zone: Z3-Z4", "節奏跑 10K");
    expect(w.title).toBe("節奏跑 10K");
    expect(w.type).toBe("tempo");
    expect(w.distanceKm).toBe(10);
    expect(w.pace).toEqual({ min: 290, max: 300 });
    expect(w.hrZones).toEqual([3, 4]);
    expect(w.hasFields).toBe(true);
  });

  it("parses an interval workout", () => {
    const w = parseWorkout(
      "type: interval\nwarmup: 2\nreps: 6x800\npace: 3:50-4:00\nrest: 2:00 jog\ncooldown: 2\nhr_zone: Z4-Z5",
    );
    expect(w.type).toBe("interval");
    expect(w.reps).toEqual({ count: 6, distanceM: 800 });
    expect(w.rest).toBe("2:00 jog");
    expect(w.warmupKm).toBe(2);
    expect(w.cooldownKm).toBe(2);
  });

  it("ignores unknown lines and HTML from the web editor", () => {
    const w = parseWorkout("<p>type: easy</p><br>記得帶水<br>distance:&nbsp;8 km<br>junk line");
    expect(w.type).toBe("easy");
    expect(w.distanceKm).toBe(8);
  });

  it("accepts duration instead of distance", () => {
    const w = parseWorkout("type: long\nduration: 1:30:00\nhr_zone: Z2");
    expect(w.durationSec).toBe(5400);
    expect(w.distanceKm).toBeUndefined();
  });

  it("reports no fields for a plain description", () => {
    const w = parseWorkout("跟朋友跑步");
    expect(w.hasFields).toBe(false);
  });

  it("parses reps with units", () => {
    expect(parseReps("5×1km")).toEqual({ count: 5, distanceM: 1000 });
    expect(parseReps("8 x 400m")).toEqual({ count: 8, distanceM: 400 });
    expect(parseReps("none")).toBeUndefined();
  });
});

describe("timezone helpers", () => {
  it("computes Taipei offset", () => {
    expect(tzOffsetString("2026-10-05", "Asia/Taipei")).toBe("+08:00");
  });

  it("converts Strava local ISO to epoch", () => {
    const ms = localIsoToEpochMs("2026-10-05T06:30:00Z", "Asia/Taipei");
    expect(new Date(ms).toISOString()).toBe("2026-10-04T22:30:00.000Z");
  });
});

describe("pickWorkout", () => {
  const ev = (id: string, dateTime: string | undefined, description: string): CalendarEvent => ({
    id,
    summary: id,
    description,
    start: dateTime ? { dateTime } : { date: "2026-10-05" },
    end: dateTime ? { dateTime } : { date: "2026-10-06" },
  });
  const activityStart = Date.parse("2026-10-05T06:30:00+08:00");

  it("returns undefined when there are no events", () => {
    expect(pickWorkout([], activityStart)).toBeUndefined();
  });

  it("picks the event closest to the activity start", () => {
    const events = [
      ev("morning", "2026-10-05T06:00:00+08:00", "type: easy\ndistance: 8"),
      ev("evening", "2026-10-05T19:00:00+08:00", "type: interval\nreps: 6x800"),
    ];
    expect(pickWorkout(events, activityStart)?.title).toBe("morning");
    expect(pickWorkout(events, Date.parse("2026-10-05T19:10:00+08:00"))?.title).toBe("evening");
  });

  it("prefers events with parsable fields over plain ones", () => {
    const events = [
      ev("note", "2026-10-05T06:30:00+08:00", "記得買鞋"),
      ev("plan", undefined, "type: long\ndistance: 20"),
    ];
    expect(pickWorkout(events, activityStart)?.title).toBe("plan");
  });

  it("falls back to a plain event when nothing parses", () => {
    const events = [ev("note", "2026-10-05T06:30:00+08:00", "記得買鞋")];
    const w = pickWorkout(events, activityStart);
    expect(w?.title).toBe("note");
    expect(w?.hasFields).toBe(false);
  });
});

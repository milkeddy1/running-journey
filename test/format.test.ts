import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatPace,
  formatPaceRange,
  paceFromDistance,
  parseClock,
  parsePaceRange,
  parseZoneRange,
} from "../src/format";

describe("format", () => {
  it("formats pace", () => {
    expect(formatPace(293)).toBe("4:53");
    expect(formatPace(300)).toBe("5:00");
    expect(formatPace(NaN)).toBe("--:--");
  });

  it("formats duration", () => {
    expect(formatDuration(2961)).toBe("49:21");
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("computes pace from distance", () => {
    expect(formatPace(paceFromDistance(10120, 2961))).toBe("4:53");
  });

  it("parses clock", () => {
    expect(parseClock("4:50")).toBe(290);
    expect(parseClock("1:02:30")).toBe(3750);
    expect(parseClock("abc")).toBeNull();
  });

  it("parses pace ranges in several notations", () => {
    expect(parsePaceRange("4:50-5:00")).toEqual({ min: 290, max: 300 });
    expect(parsePaceRange("5:00–4:50")).toEqual({ min: 290, max: 300 });
    expect(parsePaceRange("4:50~5:00 /km")).toEqual({ min: 290, max: 300 });
    expect(parsePaceRange("4:30")).toEqual({ min: 270, max: 270 });
    expect(parsePaceRange("fast")).toBeNull();
    expect(formatPaceRange({ min: 290, max: 300 })).toBe("4:50–5:00");
  });

  it("parses HR zones", () => {
    expect(parseZoneRange("Z2")).toEqual([2, 2]);
    expect(parseZoneRange("Z3-Z4")).toEqual([3, 4]);
    expect(parseZoneRange("z4–z3")).toEqual([3, 4]);
    expect(parseZoneRange("Z9")).toBeNull();
  });
});

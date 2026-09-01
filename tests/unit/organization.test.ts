import { describe, expect, it } from "vitest";
import type { Item, TaskRepeat } from "../../src/domain/models";
import { filterRecords, nextRepeatSchedule, normalizeTags, validateOrganization, searchExcerpt } from "../../src/domain/organization";
import { zonedInstant } from "../../src/domain/timetable";

function task(date = "2026-08-31", frequency: TaskRepeat["frequency"] = "daily", zone = "Asia/Shanghai", time?: string): Item {
  return { id: "a", title: "读书", body: "读书", kind: "task", status: "open", allDay: !time, dateOnly: time ? undefined : date,
    dueAt: zonedInstant(date, time || "00:00", zone), repeat: { frequency, anchorDate: date, timeZone: zone }, reminderOffsets: [],
    revision: 1, createdAt: "2026-08-31T00:00:00Z", updatedAt: "2026-08-31T00:00:00Z" };
}

describe("record organization", () => {
  it("filters notebook scope before selection and sorts without mutating records", () => {
    const a = { ...task(), id: "a", kind: "note" as const, title: "B", notebookId: "book" };
    const b = { ...a, id: "b", title: "A", notebookId: undefined };
    expect(filterRecords([a, b], "", "all", "", false, "book")).toEqual([a]);
    expect(filterRecords([a, b, task()], "", "all", "", false, "unfiled")).toEqual([b]);
    expect(filterRecords([a, b], "", "all", "", false, "", "title")).toEqual([b, a]);
    expect(a.title).toBe("B");
  });
  it("returns a normalized match with surrounding context, never generated markup", () => {
    const text = "前文".repeat(200) + "ＡＢＣ<script>" + "后文".repeat(100);
    const result = searchExcerpt(text, "abc");
    expect(result.match).toBe("ABC"); expect(result.before.startsWith("…")).toBe(true);
    expect(result.after).toContain("<script>"); expect(result.after.endsWith("…")).toBe(true);
    expect(searchExcerpt("正文", "缺失")).toEqual({ before: "正文", match: "", after: "" });
  });
  it("normalizes fullwidth tags and deduplicates without splitting ordinary spaces", () => {
    expect(normalizeTags(" 学习，#学习,ＷＥＢ,web,读书 笔记 ")).toEqual(["学习", "WEB", "读书 笔记"]);
  });
  it("rejects too many or overlong tags instead of silently truncating", () => {
    expect(() => normalizeTags("字".repeat(21))).toThrow("20");
    expect(() => normalizeTags(Array.from({ length: 13 }, (_, i) => String(i)))).toThrow("12");
    expect(() => normalizeTags(["x\u0000y"])).toThrow();
  });
  it("pins first and combines text, tag and kind filters without exposing deleted items", () => {
    const a = task(); const b = { ...task(), id: "b", pinned: true, tags: ["学习"], updatedAt: "2026-08-01T00:00:00Z" };
    const deleted = { ...b, id: "c", deletedAt: "2026-08-31T00:00:00Z" };
    expect(filterRecords([a, b, deleted], "", "all").map(item => item.id)).toEqual(["b", "a"]);
    expect(filterRecords([a, b], "学习", "task", "学习", true)).toEqual([b]);
    expect(filterRecords([a, b], "", "note")).toEqual([]);
  });
  it("validates optional metadata while accepting unchanged old records", () => {
    expect(() => validateOrganization({ ...task(), repeat: undefined })).not.toThrow();
    for (const repeat of [null, false, {}, { frequency: "daily", anchorDate: "2026-02-30", timeZone: "Asia/Shanghai" }]) {
      expect(() => validateOrganization({ ...task(), repeat } as Item)).toThrow();
    }
    expect(() => validateOrganization({ ...task(), dueAt: undefined })).toThrow("日期");
    expect(() => validateOrganization({ ...task(), kind: "note" })).toThrow();
  });
});

describe("fixed-cadence repeating tasks", () => {
  it("moves early completion forward from the scheduled date", () => {
    expect(nextRepeatSchedule(task("2026-09-10"), new Date("2026-08-31T04:00:00Z")).dateOnly).toBe("2026-09-11");
  });
  it("skips late daily occurrences without generating a backlog", () => {
    expect(nextRepeatSchedule(task("2026-08-01"), new Date("2026-08-31T04:00:00Z")).dateOnly).toBe("2026-09-01");
  });
  it("keeps the scheduled weekday after a late completion", () => {
    expect(nextRepeatSchedule(task("2026-08-24", "weekly"), new Date("2026-09-01T04:00:00Z")).dateOnly).toBe("2026-09-07");
  });
  it("clamps month end but restores the original day in the following month", () => {
    const item = task("2026-01-31", "monthly");
    const february = nextRepeatSchedule(item, new Date("2026-01-31T04:00:00Z"));
    expect(february.dateOnly).toBe("2026-02-28");
    expect(nextRepeatSchedule({ ...item, ...february }, new Date("2026-02-28T04:00:00Z")).dateOnly).toBe("2026-03-31");
  });
  it("handles leap years and year rollover", () => {
    expect(nextRepeatSchedule(task("2028-01-31", "monthly"), new Date("2028-01-31T04:00:00Z")).dateOnly).toBe("2028-02-29");
    expect(nextRepeatSchedule(task("2026-12-31", "monthly"), new Date("2026-12-31T04:00:00Z")).dateOnly).toBe("2027-01-31");
  });
  it("uses the repeat time zone across device dates and preserves the local time across DST", () => {
    expect(nextRepeatSchedule(task("2026-08-31"), new Date("2026-08-31T23:00:00Z")).dateOnly).toBe("2026-09-02");
    const item = task("2026-03-07", "daily", "America/New_York", "09:00");
    expect(nextRepeatSchedule(item, new Date("2026-03-07T15:00:00Z"))).toEqual({ dueAt: "2026-03-08T13:00:00.000Z", dateOnly: undefined });
  });
  it("reports an impossible DST wall time instead of silently shifting it", () => {
    const item = task("2026-03-07", "daily", "America/New_York", "02:30");
    expect(() => nextRepeatSchedule(item, new Date("2026-03-07T15:00:00Z"))).toThrow("没有此时间");
  });
});

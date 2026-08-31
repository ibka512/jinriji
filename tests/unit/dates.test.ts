import { afterEach, describe, expect, it } from "vitest";
import { appointments, dateFields, dayKey, isCalendarDate, itemDay, parseSchedule, startOfWeek, taskGroup } from "../../src/domain/dates";
import type { Item } from "../../src/domain/models";

const originalTZ = process.env.TZ;
afterEach(() => { process.env.TZ = originalTZ; });
const item = (changes: Partial<Item> = {}): Item => ({ id: "1", title: "待办", body: "正文", kind: "task", status: "open", allDay: false, reminderOffsets: [], createdAt: "2026-08-31T00:00:00Z", updatedAt: "2026-08-31T00:00:00Z", revision: 1, ...changes });

describe("calendar rules", () => {
  it("validates calendar days, leap years and incomplete input", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(() => parseSchedule("", "12:00")).toThrow("先选择日期");
    expect(() => parseSchedule("2026-08-31", "24:00")).toThrow();
    expect(parseSchedule("", "")).toEqual({ allDay: false });
  });
  it.each(["Asia/Shanghai", "America/Los_Angeles", "Europe/London"])("round-trips timed entries in %s", zone => {
    process.env.TZ = zone;
    const parsed = parseSchedule("2026-08-31", "09:15");
    expect(dateFields(parsed.at)).toEqual({ date: "2026-08-31", time: "09:15" });
  });
  it("keeps all-day dates stable across time-zone changes", () => {
    process.env.TZ = "Asia/Shanghai";
    const parsed = parseSchedule("2026-08-31", "");
    process.env.TZ = "America/Los_Angeles";
    expect(dateFields(parsed.at, true, parsed.dateOnly)).toEqual({ date: "2026-08-31", time: "" });
  });
  it("rejects a skipped daylight-saving time", () => {
    process.env.TZ = "America/New_York";
    expect(() => parseSchedule("2026-03-08", "02:30")).toThrow("不存在");
  });
  it("rolls groups at local midnight and distinguishes completed/undated", () => {
    process.env.TZ = "Asia/Shanghai";
    const task = item({ dueAt: parseSchedule("2026-08-31", "").at, allDay: true, dateOnly: "2026-08-31" });
    expect(taskGroup(task, new Date("2026-08-31T23:59:00+08:00"))).toBe("today");
    expect(taskGroup(task, new Date("2026-09-01T00:00:00+08:00"))).toBe("overdue");
    expect(taskGroup(item())).toBe("undated");
    expect(taskGroup(item({ status: "completed" }))).toBe("completed");
    expect(taskGroup(task, new Date("2026-08-30T12:00:00+08:00"))).toBe("later");
  });
  it("supports old timestamp-only records without mutating them", () => {
    process.env.TZ = "Asia/Shanghai";
    const old = item({ dueAt: "2026-08-30T16:00:00.000Z", allDay: true });
    expect(itemDay(old)).toBe("2026-08-31");
    expect(old.dateOnly).toBeUndefined();
  });
  it("starts weeks on Monday across year boundaries", () => {
    const start = startOfWeek(new Date(2027, 0, 3));
    expect(dayKey(start)).toBe("2026-12-28");
  });
  it("does not fabricate appointments from completed, deleted or undated records", () => {
    const dueAt = "2026-08-31T10:00:00.000Z";
    expect(appointments([item(), item({ dueAt, status: "completed" }), item({ dueAt, deletedAt: dueAt }), item({ dueAt, kind: "note" })], [])).toHaveLength(0);
    expect(appointments([item({ dueAt })], [])).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import type { Course, RecurrenceRule, Term, TimetableData } from "../../src/domain/models";
import { academicWeek, addDays, courseOccurrences, emptyTimetable, ruleDates, validateException, validateRule, validateTerm, zonedInstant } from "../../src/domain/timetable";
import { occurrenceLanes } from "../../src/features/courses/render";

const term: Term = { id: "term", name: "秋季", startDate: "2026-08-31", endDate: "2026-09-27", totalWeeks: 4, timeZone: "Asia/Shanghai", isActive: true };
const course: Course = { id: "course", name: "课程", termId: term.id, revision: 1, createdAt: "2026-08-31T00:00:00Z", updatedAt: "2026-08-31T00:00:00Z" };
const rule: RecurrenceRule = { id: "rule", courseId: course.id, weekday: 1, startTime: "09:00", endTime: "10:00", startWeek: 1, endWeek: 4, intervalWeeks: 1 };
const data = (): TimetableData => ({ ...emptyTimetable(), terms: [term], recurrenceRules: [rule] });

describe("academic calendar", () => {
  it("counts Monday-based weeks across calendar years and leap dates", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(academicWeek({ ...term, startDate: "2025-12-29" }, "2026-01-04")).toBe(1);
    expect(academicWeek({ ...term, startDate: "2025-12-29" }, "2026-01-05")).toBe(2);
    expect(academicWeek(term, "2026-08-30")).toBe(0);
  });
  it("applies odd/even parity to semester weeks, not the month or ISO week", () => {
    expect(ruleDates({ ...rule, intervalWeeks: 2 }, term)).toEqual(["2026-08-31", "2026-09-14"]);
    expect(ruleDates({ ...rule, intervalWeeks: 2, startWeek: 2 }, term)).toEqual(["2026-09-07", "2026-09-21"]);
    expect(ruleDates({ ...rule, weekday: 7 }, term).at(-1)).toBe("2026-09-27");
  });
  it("rejects non-Monday starts, invalid lengths, inverted times and weeks", () => {
    expect(() => validateTerm({ ...term, startDate: "2026-09-01" })).toThrow("周一");
    expect(() => validateTerm({ ...term, totalWeeks: 61 })).toThrow();
    expect(() => validateRule({ ...rule, endTime: "08:00" }, term)).toThrow();
    expect(() => validateRule({ ...rule, endWeek: 5 }, term)).toThrow();
    expect(() => validateRule({ ...rule, weekday: 8 }, term)).toThrow();
  });
  it("resolves term wall times independently of device time zone", () => {
    expect(zonedInstant("2026-09-01", "09:00", "Asia/Shanghai")).toBe("2026-09-01T01:00:00.000Z");
    expect(zonedInstant("2026-09-01", "09:00", "Asia/Kolkata")).toBe("2026-09-01T03:30:00.000Z");
    expect(zonedInstant("2026-09-01", "00:00", "Pacific/Auckland")).toBe("2026-08-31T12:00:00.000Z");
  });
  it("rejects DST gaps and consistently selects the earlier repeated instant", () => {
    expect(() => zonedInstant("2026-03-08", "02:30", "America/New_York")).toThrow("没有此时间");
    expect(zonedInstant("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });
  it("expands only the bounded window, excludes deleted courses and removed rules", () => {
    expect(courseOccurrences([course], data(), "2026-09-07", "2026-09-13")).toHaveLength(1);
    expect(courseOccurrences([{ ...course, deletedAt: "now" }], data(), term.startDate, term.endDate)).toHaveLength(0);
    expect(courseOccurrences([course], { ...data(), recurrenceRules: [{ ...rule, deletedAt: "now" }] }, term.startDate, term.endDate)).toHaveLength(0);
  });
  it("moves exactly one occurrence into another week without duplicating the original", () => {
    const schedule = data();
    schedule.occurrenceExceptions.push({ id: "ex", ruleId: rule.id, originalDate: "2026-08-31", kind: "rescheduled", replacementStartAt: "2026-09-08T03:00:00Z", replacementEndAt: "2026-09-08T04:00:00Z", replacementLocation: "新教室" });
    expect(courseOccurrences([course], schedule, "2026-08-31", "2026-09-06")).toHaveLength(0);
    const moved = courseOccurrences([course], schedule, "2026-09-07", "2026-09-13");
    expect(moved).toHaveLength(2);
    expect(moved[1]).toMatchObject({ date: "2026-09-08", originalDate: "2026-08-31", location: "新教室", week: 2, adjusted: true });
  });
  it("keeps cancellation visible only to the adjustment UI and restores by removing the exception", () => {
    const schedule = data();
    schedule.occurrenceExceptions.push({ id: "ex", ruleId: rule.id, originalDate: term.startDate, kind: "cancelled" });
    expect(courseOccurrences([course], schedule, term.startDate, term.endDate)).toHaveLength(3);
    expect(courseOccurrences([course], schedule, term.startDate, term.endDate, true)[0]?.cancelled).toBe(true);
    schedule.occurrenceExceptions = [];
    expect(courseOccurrences([course], schedule, term.startDate, term.endDate)).toHaveLength(4);
  });
  it("rejects exceptions for nonexistent classes and dates outside the semester", () => {
    expect(() => validateException({ id: "ex", ruleId: rule.id, originalDate: "2026-09-01", kind: "cancelled" }, rule, term)).toThrow();
    expect(() => validateException({ id: "ex", ruleId: rule.id, originalDate: term.startDate, kind: "rescheduled", replacementStartAt: "2026-10-01T00:00:00Z", replacementEndAt: "2026-10-01T01:00:00Z" }, rule, term)).toThrow("本学期");
  });
  it("partitions overlapping course blocks while leaving later independent classes full width", () => {
    const [base] = courseOccurrences([course], data(), term.startDate, term.startDate);
    const entries = [base!, { ...base!, key: "b", startTime: "09:30", endTime: "10:30" }, { ...base!, key: "c", startTime: "11:00", endTime: "12:00" }];
    expect(occurrenceLanes(entries).map(({ lane, lanes }) => [lane, lanes])).toEqual([[0, 2], [1, 2], [0, 1]]);
  });
  it("separates the minimum touch targets of short adjacent classes", () => {
    const [base] = courseOccurrences([course], data(), term.startDate, term.startDate);
    const entries = [{ ...base!, startTime: "09:00", endTime: "09:10" }, { ...base!, key: "b", startTime: "09:10", endTime: "09:20" }, { ...base!, key: "c", startTime: "10:00", endTime: "10:10" }];
    expect(occurrenceLanes(entries).map(({ lane, lanes }) => [lane, lanes])).toEqual([[0, 2], [1, 2], [0, 1]]);
  });
});

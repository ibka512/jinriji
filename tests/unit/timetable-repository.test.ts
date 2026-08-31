import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { JinrijiDatabase } from "../../src/data/database";
import { AppRepository, RECOVERY_KEY } from "../../src/data/repositories";
import { TimetableRepository } from "../../src/data/timetable-repository";
import { createBackup, createFullBackup, parseBackup } from "../../src/data/backup";
import { courseOccurrences } from "../../src/domain/timetable";
import type { RecurrenceRule, Term } from "../../src/domain/models";

const databases: JinrijiDatabase[] = [];
async function setup() {
  const db = new JinrijiDatabase(`timetable-${crypto.randomUUID()}`); databases.push(db);
  const app = new AppRepository(db); const study = new TimetableRepository(db);
  const term: Term = { id: "term", name: "秋季", startDate: "2026-08-31", endDate: "2026-09-27", totalWeeks: 4, timeZone: "Asia/Shanghai", isActive: true };
  await study.saveTerm(term);
  const course = await app.createCourse({ name: "课程", location: "教室", instructor: "老师" });
  const rule: RecurrenceRule = { id: "rule", courseId: course.id, weekday: 1, startTime: "09:00", endTime: "10:00", startWeek: 1, endWeek: 4, intervalWeeks: 1 };
  await study.saveRule(rule, term.id, 0, 1, 1);
  return { db, app, study, term, course, rule };
}
afterEach(async () => { await Promise.all(databases.splice(0).map(db => db.delete())); });

it("keeps one current term and detects stale term/rule saves", async () => {
  const { db, study, term, rule } = await setup();
  await study.saveTerm({ ...term, id: "other", name: "新学期" });
  expect((await db.terms.toArray()).filter(term => term.isActive)).toHaveLength(1);
  await expect(study.saveTerm(term, 1)).rejects.toThrow("变动");
  await expect(study.saveRule(rule, term.id, 0)).rejects.toThrow("变动");
});
it("protects old schedules when a term or rule edit invalidates a single-class exception", async () => {
  const { db, study, term, rule } = await setup();
  await study.saveException({ id: "ex", ruleId: rule.id, originalDate: term.startDate, kind: "cancelled" }, 0, 1);
  await expect(study.saveRule({ ...rule, weekday: 2 }, term.id, 1)).rejects.toThrow("单次调课");
  await expect(study.saveTerm({ ...term, totalWeeks: 2, endDate: "2026-09-13" }, 1)).rejects.toThrow();
  expect((await db.recurrenceRules.get(rule.id))?.weekday).toBe(1);
  expect((await db.terms.get(term.id))?.totalWeeks).toBe(4);
});
it("keeps linked notes and rules when a course is deleted, then restores the schedule", async () => {
  const { app, course } = await setup();
  const item = await app.createItem({ title: "课堂笔记", kind: "note", courseId: course.id });
  await app.updateCourse(course.id, { deletedAt: "2026-08-31T00:00:00Z" });
  let all = await app.allRecords();
  expect(all.items[0]?.id).toBe(item.id); expect(all.recurrenceRules).toHaveLength(1);
  expect(courseOccurrences(all.courses, all, "2026-08-31", "2026-09-27")).toHaveLength(0);
  await app.updateCourse(course.id, { deletedAt: undefined }); all = await app.allRecords();
  expect(courseOccurrences(all.courses, all, "2026-08-31", "2026-09-27")).toHaveLength(4);
});
it("round trips every academic table in v3 and restores them after importing v2", async () => {
  const { app, study, rule, term } = await setup();
  await study.saveException({ id: "ex", ruleId: rule.id, originalDate: term.startDate, kind: "cancelled" }, 0, 1);
  const original = await app.allRecords();
  const backup = createFullBackup(original.items, original.courses, "sage", original);
  expect(parseBackup(JSON.stringify(backup))).toEqual(backup);
  await app.importBackup(createBackup([], [], "sage", true));
  expect((await app.allRecords()).terms).toHaveLength(0);
  await app.restoreRecovery();
  const restored = await app.allRecords();
  expect(restored.terms).toHaveLength(1); expect(restored.recurrenceRules).toHaveLength(1); expect(restored.occurrenceExceptions).toHaveLength(1);
  expect(courseOccurrences(restored.courses, restored, term.startDate, term.endDate)).toHaveLength(3);
});
it("rolls back the entire import and recovery point if an academic table fails", async () => {
  const { app, db } = await setup(); const original = await app.allRecords();
  db.recurrenceRules.hook("creating", () => { throw new Error("写入失败"); });
  await expect(app.importBackup(createFullBackup([], original.courses, "sakura", original))).rejects.toThrow();
  expect(await app.allRecords()).toEqual(original);
  expect(await db.settings.get(RECOVERY_KEY)).toBeUndefined();
});
it("rejects duplicate exceptions and broken course/rule links before import", async () => {
  const { app, rule, term } = await setup(); const all = await app.allRecords();
  const backup = createFullBackup([], all.courses, "sage", all);
  expect(() => parseBackup(JSON.stringify({ ...backup, courses: [] }))).toThrow("缺少对应");
  const ex = { id: "ex", ruleId: rule.id, originalDate: term.startDate, kind: "cancelled" };
  expect(() => parseBackup(JSON.stringify({ ...backup, occurrenceExceptions: [ex, { ...ex, id: "ex2" }] }))).toThrow("重复");
  expect(() => parseBackup(JSON.stringify({ ...backup, terms: [{ ...term, timeZone: "Invalid" }] }))).toThrow();
});
it("prevents stale course editors from overwriting after attaching a rule and stale exception saves", async () => {
  const { app, study, course, rule, term } = await setup();
  await expect(app.updateCourse(course.id, { name: "过期标题" }, 1)).rejects.toThrow();
  const exception = { id: "ex", ruleId: rule.id, originalDate: term.startDate, kind: "cancelled" as const };
  await study.saveException(exception, 0, 1);
  await expect(study.saveException(exception, 0, 1)).rejects.toThrow("变动");
  await study.resetException("ex", 1);
  const all = await app.allRecords(); expect(all.occurrenceExceptions).toHaveLength(0);
});

it("keeps retired rules and their exceptions exportable after a semester is shortened", async () => {
  const { app, study, term, rule } = await setup();
  await study.saveException({ id: "ex", ruleId: rule.id, originalDate: "2026-09-21", kind: "cancelled" }, 0, 1);
  await study.deleteRule(rule.id, 1);
  await study.saveTerm({ ...term, totalWeeks: 2, endDate: "2026-09-13" }, 1);
  const all = await app.allRecords();
  const backup = createFullBackup(all.items, all.courses, "sage", all);
  expect(parseBackup(JSON.stringify(backup))).toEqual(backup);
  expect(all.recurrenceRules[0]?.deletedAt).toBeTruthy();
  expect(all.occurrenceExceptions).toHaveLength(1);
});

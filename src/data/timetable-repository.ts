import type { OccurrenceException, RecurrenceRule, Term } from "../domain/models";
import { ruleDates, validateException, validateRule, validateTerm } from "../domain/timetable";
import type { JinrijiDatabase } from "./database";

function revision(current: { revision?: number } | undefined, expected: number): void {
  if ((current?.revision ?? 0) !== expected) throw new Error("安排已在其他页面变动，请关闭后重新打开；输入仍保留");
}

export class TimetableRepository {
  constructor(private readonly database: JinrijiDatabase) {}

  async saveTerm(term: Term, expected = 0): Promise<void> {
    validateTerm(term);
    await this.database.transaction("rw", [this.database.terms, this.database.courses, this.database.recurrenceRules, this.database.occurrenceExceptions], async () => {
      const current = await this.database.terms.get(term.id);
      revision(current, expected);
      const courses = await this.database.courses.where("termId").equals(term.id).toArray();
      for (const course of courses) {
        const rules = await this.database.recurrenceRules.where("courseId").equals(course.id).toArray();
        for (const rule of rules.filter(rule => !rule.deletedAt)) {
          validateRule(rule, term);
          for (const exception of await this.database.occurrenceExceptions.where("ruleId").equals(rule.id).toArray()) {
            validateException(exception, rule, term);
          }
        }
      }
      if (term.isActive) {
        for (const existing of await this.database.terms.toArray()) {
          if (existing.id !== term.id && existing.isActive) await this.database.terms.put({ ...existing, isActive: false, revision: (existing.revision ?? 0) + 1 });
        }
      }
      await this.database.terms.put({ ...term, revision: (current?.revision ?? 0) + 1 });
    });
  }

  async saveRule(rule: RecurrenceRule, termId: string, expected = 0, courseRevision?: number, termRevision?: number): Promise<void> {
    await this.database.transaction("rw", [this.database.courses, this.database.terms, this.database.recurrenceRules, this.database.occurrenceExceptions], async () => {
      const course = await this.database.courses.get(rule.courseId);
      const term = await this.database.terms.get(termId);
      if (!course || course.deletedAt || !term) throw new Error("课程或学期已不存在，请重新打开");
      if (courseRevision !== undefined) revision(course, courseRevision);
      if (termRevision !== undefined) revision(term, termRevision);
      if (course.termId && course.termId !== termId) throw new Error("这门课程属于其他学期，请在该学期编辑或新建课程");
      const current = await this.database.recurrenceRules.get(rule.id);
      revision(current, expected);
      if (current && current.courseId !== course.id) throw new Error("规则所属课程不一致");
      validateRule(rule, term);
      for (const exception of await this.database.occurrenceExceptions.where("ruleId").equals(rule.id).toArray()) {
        if (!ruleDates(rule, term).includes(exception.originalDate)) throw new Error("调整周次会移除已有单次调课，请先恢复相关课次再修改规则");
        validateException(exception, rule, term);
      }
      await this.database.recurrenceRules.put({ ...rule, revision: (current?.revision ?? 0) + 1 });
      await this.database.courses.put({ ...course, termId, revision: course.revision + 1, updatedAt: new Date().toISOString() });
    });
  }

  async deleteRule(id: string, expected: number): Promise<void> {
    await this.database.transaction("rw", this.database.recurrenceRules, async () => {
      const current = await this.database.recurrenceRules.get(id);
      if (!current) throw new Error("排课规则已不存在");
      revision(current, expected);
      await this.database.recurrenceRules.put({ ...current, deletedAt: new Date().toISOString(), revision: (current.revision ?? 0) + 1 });
    });
  }

  async saveException(exception: OccurrenceException, expected: number, ruleRevision: number): Promise<void> {
    await this.database.transaction("rw", [this.database.occurrenceExceptions, this.database.recurrenceRules, this.database.courses, this.database.terms], async () => {
      const rule = await this.database.recurrenceRules.get(exception.ruleId);
      const course = rule && await this.database.courses.get(rule.courseId);
      const term = course?.termId && await this.database.terms.get(course.termId);
      if (!rule || rule.deletedAt || !course || course.deletedAt || !term) throw new Error("课程安排已不存在");
      revision(rule, ruleRevision);
      const existing = (await this.database.occurrenceExceptions.where("ruleId").equals(rule.id).toArray()).find(value => value.originalDate === exception.originalDate);
      revision(existing, expected);
      validateException(exception, rule, term);
      await this.database.occurrenceExceptions.put({ ...exception, id: existing?.id ?? exception.id, revision: (existing?.revision ?? 0) + 1 });
    });
  }

  async resetException(id: string, expected: number): Promise<void> {
    await this.database.transaction("rw", this.database.occurrenceExceptions, async () => {
      const current = await this.database.occurrenceExceptions.get(id);
      if (!current) throw new Error("单次调整已不存在");
      revision(current, expected);
      await this.database.occurrenceExceptions.delete(id);
    });
  }
}

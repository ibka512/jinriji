import type { Course, OccurrenceException, RecurrenceRule, Term, TimetableData } from "./models";
import { dayKey, isCalendarDate } from "./dates";

export const emptyTimetable = (): TimetableData => ({ terms: [], recurrenceRules: [], occurrenceExceptions: [] });
const DAY = 86_400_000;
export const validTime = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const calendarNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`);
export function addDays(date: string, days: number): string { return new Date(calendarNumber(date) + days * DAY).toISOString().slice(0, 10); }
export function weekday(date: string): number { return (new Date(calendarNumber(date)).getUTCDay() + 6) % 7 + 1; }
export function academicWeek(term: Term, date: string): number { return Math.floor((calendarNumber(date) - calendarNumber(term.startDate)) / (7 * DAY)) + 1; }
export function isTimeZone(zone: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return true; } catch { return false; }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
export function zonedFields(date: Date, timeZone: string): { date: string; time: string } {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Resolve a wall time without changing the semester's time zone when the device travels.
 * Nonexistent DST times are rejected; duplicated times consistently select the earlier instant.
 */
export function zonedInstant(date: string, time: string, timeZone: string): string {
  if (!isCalendarDate(date) || !validTime(time) || !isTimeZone(timeZone)) throw new Error("日期、时间或时区无效");
  const naive = Date.parse(`${date}T${time}:00Z`);
  const candidates = new Set<number>();
  for (const delta of [-DAY, 0, DAY]) {
    const sample = naive + delta;
    const wall = zonedFields(new Date(sample), timeZone);
    const offset = Date.parse(`${wall.date}T${wall.time}:00Z`) - sample;
    const candidate = naive - offset;
    const check = zonedFields(new Date(candidate), timeZone);
    if (check.date === date && check.time === time) candidates.add(candidate);
  }
  if (!candidates.size) throw new Error("该时区在这个日期没有此时间，请调整上课时间");
  return new Date(Math.min(...candidates)).toISOString();
}

export function validateTerm(term: Term): void {
  if (!term.id || !term.name.trim() || term.name.length > 200) throw new Error("请输入学期名称（不超过 200 字）");
  if (!isCalendarDate(term.startDate) || weekday(term.startDate) !== 1) throw new Error("第一周请从周一开始");
  if (!Number.isInteger(term.totalWeeks) || term.totalWeeks < 1 || term.totalWeeks > 60) throw new Error("学期周数须为 1–60");
  if (term.endDate !== addDays(term.startDate, term.totalWeeks * 7 - 1)) throw new Error("学期结束日期与周数不一致");
  if (!isTimeZone(term.timeZone)) throw new Error("学期时区无效");
  if (typeof term.isActive !== "boolean") throw new Error("学期状态无效");
}

export function ruleDates(rule: RecurrenceRule, term: Term): string[] {
  const dates: string[] = [];
  for (let week = rule.startWeek; week <= Math.min(rule.endWeek, term.totalWeeks); week += rule.intervalWeeks) {
    const date = addDays(term.startDate, (week - 1) * 7 + rule.weekday - 1);
    if (date <= term.endDate) dates.push(date);
  }
  return dates;
}

export function validateRuleShape(rule: RecurrenceRule, maxWeek = 60): void {
  if (!rule.id || !rule.courseId || !Number.isInteger(rule.weekday) || rule.weekday < 1 || rule.weekday > 7) throw new Error("请选择上课星期");
  if (!validTime(rule.startTime) || !validTime(rule.endTime) || rule.endTime <= rule.startTime) throw new Error("下课时间须晚于上课时间（同一天）");
  if (![1, 2].includes(rule.intervalWeeks) || !Number.isInteger(rule.startWeek) || !Number.isInteger(rule.endWeek) || rule.startWeek < 1 || rule.endWeek > maxWeek || rule.endWeek < rule.startWeek) throw new Error("请检查起止周次与重复方式");
  if (rule.location !== undefined && (typeof rule.location !== "string" || rule.location.length > 200)) throw new Error("上课地点过长");
}

export function validateRule(rule: RecurrenceRule, term: Term): void {
  validateRuleShape(rule, term.totalWeeks);
  for (const date of ruleDates(rule, term)) {
    zonedInstant(date, rule.startTime, term.timeZone); zonedInstant(date, rule.endTime, term.timeZone);
  }
}

export function validateExceptionShape(exception: OccurrenceException): void {
  if (!exception.id || !isCalendarDate(exception.originalDate)) throw new Error("原上课日期无效");
  if (!["cancelled", "rescheduled"].includes(exception.kind)) throw new Error("单次调整类型无效");
  if (exception.kind === "rescheduled") {
    const start = Date.parse(exception.replacementStartAt || "");
    const end = Date.parse(exception.replacementEndAt || "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("请设置有效的调课起止时间");
  }
  if (exception.replacementLocation !== undefined && (typeof exception.replacementLocation !== "string" || exception.replacementLocation.length > 200)) throw new Error("调课地点过长");
}

export function validateException(exception: OccurrenceException, rule: RecurrenceRule, term: Term): void {
  validateExceptionShape(exception);
  if (!ruleDates(rule, term).includes(exception.originalDate)) throw new Error("原日期不是这条规则的上课日");
  if (exception.kind === "rescheduled") {
    const first = zonedFields(new Date(exception.replacementStartAt!), term.timeZone);
    const last = zonedFields(new Date(exception.replacementEndAt!), term.timeZone);
    if (first.date !== last.date || first.date < term.startDate || first.date > term.endDate) throw new Error("调课须在本学期内，且在同一天结束");
  }
}

export interface CourseOccurrence {
  key: string;
  courseId: string;
  ruleId: string;
  termId: string;
  originalDate: string;
  date: string;
  startAt: string;
  endAt: string;
  startTime: string;
  endTime: string;
  location: string;
  name: string;
  week: number;
  adjusted: boolean;
  cancelled: boolean;
}

export function courseOccurrences(courses: Course[], data: TimetableData, from: string, to: string, includeCancelled = false): CourseOccurrence[] {
  const terms = new Map(data.terms.map(term => [term.id, term]));
  const courseMap = new Map(courses.filter(course => !course.deletedAt).map(course => [course.id, course]));
  const exceptions = new Map(data.occurrenceExceptions.map(exception => [`${exception.ruleId}\0${exception.originalDate}`, exception]));
  const result: CourseOccurrence[] = [];
  for (const rule of data.recurrenceRules) {
    const course = courseMap.get(rule.courseId);
    const term = course?.termId ? terms.get(course.termId) : undefined;
    if (!course || !term || rule.deletedAt) continue;
    for (const originalDate of ruleDates(rule, term)) {
      const exception = exceptions.get(`${rule.id}\0${originalDate}`);
      const cancelled = exception?.kind === "cancelled";
      if (cancelled && !includeCancelled) continue;
      if (!exception && (originalDate < from || originalDate > to)) continue;
      try {
        const moved = exception?.kind === "rescheduled";
        const startAt = moved ? exception.replacementStartAt! : zonedInstant(originalDate, rule.startTime, term.timeZone);
        const endAt = moved ? exception.replacementEndAt! : zonedInstant(originalDate, rule.endTime, term.timeZone);
        const start = zonedFields(new Date(startAt), term.timeZone);
        if (start.date < from || start.date > to) continue;
        result.push({ key: `${rule.id}/${originalDate}`, courseId: course.id, ruleId: rule.id, termId: term.id,
          originalDate, date: start.date, startAt, endAt, startTime: start.time, endTime: zonedFields(new Date(endAt), term.timeZone).time,
          name: course.name, location: exception?.replacementLocation ?? rule.location ?? course.location ?? "",
          week: academicWeek(term, start.date), adjusted: Boolean(exception), cancelled });
      } catch { /* Invalid legacy rules cannot crash the user's other records. Editors/backup reject new invalid input. */ }
    }
  }
  return result.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.key.localeCompare(b.key));
}

export function ruleLabel(rule: RecurrenceRule): string {
  const recurrence = rule.intervalWeeks === 1 ? "每周" : rule.startWeek % 2 ? "单周" : "双周";
  return `周${"一二三四五六日"[rule.weekday - 1]} ${rule.startTime}–${rule.endTime} · ${rule.startWeek}–${rule.endWeek}周 ${recurrence}`;
}

export function defaultTerm(now = new Date()): Term {
  const today = dayKey(now);
  const startDate = addDays(today, 1 - weekday(today));
  return { id: crypto.randomUUID(), name: "", startDate, totalWeeks: 18, endDate: addDays(startDate, 18 * 7 - 1), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, isActive: true };
}

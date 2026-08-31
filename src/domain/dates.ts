import type { Course, Item } from "./models";

const pad = (value: number): string => String(value).padStart(2, "0");

export function dayKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.valueOf()) && dayKey(date) === value;
}

export function parseSchedule(date: string, time: string): { at?: string; allDay: boolean; dateOnly?: string } {
  if (!date && time) throw new Error("请先选择日期");
  if (!date) return { allDay: false };
  if (!isCalendarDate(date)) throw new Error("请选择有效日期");
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("请选择有效时间");
  const local = new Date(`${date}T${time || "00:00"}:00`);
  if (time && `${pad(local.getHours())}:${pad(local.getMinutes())}` !== time) {
    throw new Error("这个时间在当前时区不存在，请选择其他时间");
  }
  return { at: local.toISOString(), allDay: !time, dateOnly: time ? undefined : date };
}

export function entryDay(at?: string, dateOnly?: string): string | undefined {
  if (dateOnly && isCalendarDate(dateOnly)) return dateOnly;
  if (!at || !Number.isFinite(new Date(at).valueOf())) return undefined;
  return dayKey(new Date(at));
}

export function dateFields(at?: string, allDay = false, dateOnly?: string): { date: string; time: string } {
  const date = entryDay(at, allDay ? dateOnly : undefined) || "";
  const parsed = at ? new Date(at) : undefined;
  return { date, time: !allDay && parsed && date ? `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}` : "" };
}

export function momentLabel(at?: string, allDay = false, dateOnly?: string): string {
  const key = entryDay(at, allDay ? dateOnly : undefined);
  if (!key) return "未设日期";
  const date = allDay ? new Date(`${key}T12:00:00`) : new Date(at!);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: allDay ? undefined : "2-digit", minute: allDay ? undefined : "2-digit", hourCycle: "h23",
  }).format(date) + (allDay ? " · 全天" : "");
}

export const itemTime = (item: Item): string | undefined => item.kind === "task" ? item.dueAt : item.startAt;
export const itemDay = (item: Item): string | undefined => entryDay(itemTime(item), item.allDay ? item.dateOnly : undefined);
export type TaskGroup = "overdue" | "today" | "later" | "undated" | "completed";
export const taskGroupNames: Record<TaskGroup, string> = { overdue: "逾期", today: "今天", later: "以后", undated: "未设日期", completed: "已完成" };

export function taskGroup(item: Item, now = new Date()): TaskGroup {
  if (item.status === "completed") return "completed";
  const date = itemDay(item);
  if (!date) return "undated";
  if (date < dayKey(now)) return "overdue";
  return date === dayKey(now) ? "today" : "later";
}

export interface Appointment {
  id: string;
  entity: "item" | "course";
  title: string;
  at: string;
  day: string;
  allDay: boolean;
  dateOnly?: string;
  endAt?: string;
}

export function appointments(items: Item[], courses: Course[]): Appointment[] {
  const result: Appointment[] = [];
  for (const item of items) {
    const at = itemTime(item);
    const day = itemDay(item);
    if (!item.deletedAt && item.kind !== "note" && item.status === "open" && at && day) {
      result.push({ id: item.id, entity: "item", title: item.title, at, day, allDay: item.allDay, dateOnly: item.dateOnly });
    }
  }
  for (const course of courses) {
    const day = entryDay(course.firstMeetingAt, course.allDay ? course.dateOnly : undefined);
    if (!course.deletedAt && course.firstMeetingAt && day) {
      result.push({ id: course.id, entity: "course", title: course.name, at: course.firstMeetingAt, day, allDay: course.allDay ?? false, dateOnly: course.dateOnly });
    }
  }
  return result.sort((a, b) => a.day.localeCompare(b.day) || Number(b.allDay) - Number(a.allDay) || new Date(a.at).valueOf() - new Date(b.at).valueOf());
}

export function startOfWeek(now = new Date()): Date {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return date;
}

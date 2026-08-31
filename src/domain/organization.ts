import type { Item } from "./models";
import { isCalendarDate } from "./dates";
import { addDays, zonedFields, zonedInstant } from "./timetable";

export const repeatNames = { daily: "每天", weekly: "每周", monthly: "每月" };
export const tagKey = (tag: string): string => tag.normalize("NFKC").toLocaleLowerCase();

export function normalizeTags(input: string | string[]): string[] {
  const values = typeof input === "string" ? input.split(/[,，\n]/) : input;
  if (!Array.isArray(values) || values.some(value => typeof value !== "string")) throw new Error("标签格式无效");
  const unique = new Map<string, string>();
  for (const value of values) {
    const tag = value.trim().replace(/^#+/, "").normalize("NFKC").trim();
    if (!tag) continue;
    if ([...tag].length > 20 || /[\u0000-\u001f]/.test(tag)) throw new Error("每个标签最多 20 个字，不能含控制字符");
    unique.set(tagKey(tag), unique.get(tagKey(tag)) || tag);
  }
  if (unique.size > 12) throw new Error("每条记录最多 12 个标签");
  return [...unique.values()];
}

export function validateOrganization(item: Item): void {
  if (item.pinned !== undefined && typeof item.pinned !== "boolean") throw new Error("置顶标记无效");
  if (item.tags !== undefined) {
    if (!Array.isArray(item.tags) || item.tags.length > 12) throw new Error("标签格式无效");
    normalizeTags(item.tags);
  }
  if (item.repeatNextId !== undefined && (typeof item.repeatNextId !== "string" || !item.repeatNextId || item.repeatNextId.length > 512 || item.repeatNextId === item.id)) throw new Error("重复待办关联无效");
  const repeat = item.repeat;
  if (repeat === undefined) return;
  if (!repeat || typeof repeat !== "object" || !["daily", "weekly", "monthly"].includes(repeat.frequency) ||
    typeof repeat.anchorDate !== "string" || !isCalendarDate(repeat.anchorDate) ||
    typeof repeat.timeZone !== "string" || repeat.timeZone.length > 200) throw new Error("重复规则无效");
  if (item.kind !== "task" || !item.dueAt || !Number.isFinite(Date.parse(item.dueAt))) throw new Error("重复待办需要设置日期");
  try { zonedFields(new Date(item.dueAt), repeat.timeZone); } catch { throw new Error("重复待办时区无效"); }
}

/** Fixed calendar cadence; missing dates are skipped, and a short month does not change the anchor day. */
export function nextRepeatSchedule(item: Item, now = new Date()): { dueAt: string; dateOnly?: string } {
  validateOrganization(item);
  const rule = item.repeat!;
  const fields = zonedFields(new Date(item.dueAt!), rule.timeZone);
  const base = item.allDay ? item.dateOnly || fields.date : fields.date;
  const threshold = [base, zonedFields(now, rule.timeZone).date].sort().at(-1)!;
  let next: string;
  if (rule.frequency === "monthly") {
    let year = Number(threshold.slice(0, 4)); let month = Number(threshold.slice(5, 7));
    const anchor = Number(rule.anchorDate.slice(8));
    const at = (): string => `${year}-${String(month).padStart(2, "0")}-${String(Math.min(anchor, new Date(Date.UTC(year, month, 0)).getUTCDate())).padStart(2, "0")}`;
    next = at();
    if (next <= threshold) { month++; if (month > 12) { year++; month = 1; } next = at(); }
  } else {
    const step = rule.frequency === "daily" ? 1 : 7;
    const days = Math.round((Date.parse(`${threshold}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86_400_000);
    next = addDays(base, (Math.floor(days / step) + 1) * step);
  }
  if (!isCalendarDate(next)) throw new Error("下一次日期超出支持范围，请关闭重复后保存");
  return { dueAt: zonedInstant(next, item.allDay ? "00:00" : fields.time, rule.timeZone), dateOnly: item.allDay ? next : undefined };
}

export function filterRecords(items: Item[], search: string, filter: string, tag = "", pinnedOnly = false): Item[] {
  const needle = tagKey(search.trim());
  return items.filter(item => !item.deletedAt && (filter === "all" || item.kind === filter) &&
    (!pinnedOnly || item.pinned) && (!tag || item.tags?.some(value => tagKey(value) === tagKey(tag))) &&
    tagKey(`${item.title}\n${item.body}\n${(item.tags || []).join(" ")}`).includes(needle))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

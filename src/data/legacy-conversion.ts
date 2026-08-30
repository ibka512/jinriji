import type { Course, Item, LegacyEntry } from "../domain/models";

function validIso(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed.toISOString();
}

export function combineLocalDateTime(date?: string, time?: string): string | undefined {
  if (!date) return undefined;
  const parsed = new Date(`${date}T${time || "00:00"}:00`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

export function legacyEntryToRecord(entry: LegacyEntry, index: number, now = new Date().toISOString()): Item | Course {
  const id = entry.id || `legacy-${index}-${crypto.randomUUID?.() || Date.now()}`;
  const title = String(entry.text || "未命名记录").trim() || "未命名记录";
  const createdAt = validIso(entry.createdAt, now);
  const scheduledAt = combineLocalDateTime(entry.date, entry.time);

  if (entry.type === "course") {
    return {
      id,
      name: title,
      firstMeetingAt: scheduledAt,
      createdAt,
      updatedAt: createdAt,
      revision: 1,
    } satisfies Course;
  }

  const kind = entry.type === "task" ? "task" : entry.type === "schedule" ? "event" : "note";
  return {
    id,
    kind,
    title,
    body: title,
    status: entry.done ? "completed" : "open",
    dueAt: kind === "task" ? scheduledAt : undefined,
    startAt: kind === "event" ? scheduledAt : undefined,
    allDay: Boolean(entry.date && !entry.time),
    reminderOffsets: [],
    createdAt,
    updatedAt: createdAt,
    revision: 1,
  } satisfies Item;
}

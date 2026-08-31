import type { BackupPayload, BackupPayloadV2, BackupPayloadV6, Course, Item, LegacyEntry, OccurrenceException, RecurrenceRule, Term, TimetableData, LibraryData } from "../domain/models";
import { documentReferences, nameNotebook, validateAsset, type Notebook, type NoteAsset } from "../domain/notebooks";
import { validateDocument, documentText } from "../domain/note-document";
import { validateOrganization } from "../domain/organization";
import { legacyEntryToRecord } from "./legacy-conversion";
import { isCalendarDate } from "../domain/dates";
import { validateException, validateExceptionShape, validateRule, validateRuleShape, validateTerm } from "../domain/timetable";

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("备份中包含无效记录");
  return value as Record<string, unknown>;
}

function textField(record: Record<string, unknown>, key: string, required = false, limit = 200_000): void {
  const value = record[key];
  if (value === undefined && !required) return;
  if (typeof value !== "string" || value.length > limit || (required && !value.trim())) throw new Error(`备份字段 ${key} 无效`);
}

function timestamp(record: Record<string, unknown>, key: string, required = false): void {
  textField(record, key, required, 64);
  const value = record[key];
  if (typeof value === "string" && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !isCalendarDate(value.slice(0, 10)) || !Number.isFinite(new Date(value).valueOf()))) {
    throw new Error(`备份时间 ${key} 无效`);
  }
}

function validateRecord(value: unknown, course = false): Item | Course {
  const record = object(value);
  textField(record, "id", true, 512);
  textField(record, course ? "name" : "title", true);
  timestamp(record, "createdAt", true);
  timestamp(record, "updatedAt", true);
  timestamp(record, "deletedAt");
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) throw new Error("备份记录版本无效");
  if (record.dateOnly !== undefined && (typeof record.dateOnly !== "string" || !isCalendarDate(record.dateOnly))) throw new Error("备份日期无效");
  if (record.allDay !== undefined && typeof record.allDay !== "boolean") throw new Error("全天标记无效");
  if (course) {
    timestamp(record, "firstMeetingAt");
    for (const key of ["instructor", "location", "color", "termId"]) textField(record, key);
    return record as unknown as Course;
  }
  textField(record, "body", false);
  if (typeof record.body !== "string" || typeof record.allDay !== "boolean") throw new Error("备份记录缺少正文或全天标记");
  if (!["note", "task", "event"].includes(String(record.kind)) || !["open", "completed", "archived"].includes(String(record.status))) throw new Error("备份记录类型或状态无效");
  for (const key of ["dueAt", "startAt", "endAt", "completedAt"]) timestamp(record, key);
  textField(record, "courseId");
  textField(record, "notebookId", false, 512); textField(record, "sourceNoteId", false, 512);
  if (!Array.isArray(record.reminderOffsets) || !record.reminderOffsets.every(offset => typeof offset === "number" && Number.isFinite(offset) && offset >= 0)) throw new Error("备份提醒设置无效");
  validateOrganization(record as unknown as Item);
  if (record.document !== undefined) {
    validateDocument(record.document);
    if (record.body !== documentText(record.document)) throw new Error("备份正文与检索文本不一致");
  }
  return record as unknown as Item;
}

function records<T extends Item | Course>(values: unknown[], course = false): T[] {
  if (values.length > 20_000) throw new Error("单次最多导入 20,000 条记录");
  const ids = new Set<string>();
  return values.map(value => {
    const record = validateRecord(value, course) as T;
    if (ids.has(record.id)) throw new Error("备份包含重复记录 ID，未导入");
    ids.add(record.id);
    return record;
  });
}

export function createBackup(items: Item[], courses: Course[], theme: string, glass: boolean): BackupPayloadV2 {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    theme,
    glass,
    items,
    courses,
  };
}

export function createFullBackup(items: Item[], courses: Course[], theme: string, timetable: TimetableData & Partial<LibraryData>): BackupPayloadV6 {
  const references = new Set(items.flatMap(item => [...documentReferences(item.document).assets]));
  return { ...createBackup(items, courses, theme, true), version: 6, terms: timetable.terms,
    recurrenceRules: timetable.recurrenceRules, occurrenceExceptions: timetable.occurrenceExceptions,
    notebooks: timetable.notebooks || [], assets: (timetable.assets || []).filter(asset => references.has(asset.id)) };
}

function timetableRecords<T>(value: unknown, limit: number, validate: (record: Record<string, unknown>) => void): T[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error("排课数据缺失或超出备份数量限制");
  const ids = new Set<string>();
  return value.map(entry => {
    const record = object(entry);
    textField(record, "id", true, 512);
    if (ids.has(record.id as string)) throw new Error("备份包含重复排课 ID");
    ids.add(record.id as string);
    if (record.revision !== undefined && (!Number.isSafeInteger(record.revision) || (record.revision as number) < 0)) throw new Error("排课版本无效");
    validate(record);
    return record as T;
  });
}

export function parseBackup(raw: string): BackupPayload {
  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) throw new Error("备份不能超过 64 MB");
  const payload: unknown = JSON.parse(raw);
  if (!payload || typeof payload !== "object") throw new Error("备份文件不是有效对象。");
  const candidate = payload as Record<string, unknown>;

  if ([2, 3, 4, 5, 6].includes(Number(candidate.version)) && typeof candidate.version === "number" && Array.isArray(candidate.items) && Array.isArray(candidate.courses)) {
    timestamp(candidate, "exportedAt", true);
    if (typeof candidate.theme !== "string" || typeof candidate.glass !== "boolean") throw new Error("备份设置无效");
    const base: BackupPayloadV2 = { version: 2, exportedAt: candidate.exportedAt as string, theme: candidate.theme, glass: candidate.glass,
      items: records<Item>(candidate.items), courses: records<Course>(candidate.courses, true) };
    if (candidate.version === 2) {
      if (base.items.some(item => item.notebookId || documentReferences(item.document).assets.size)) throw new Error("笔记本与图片需要 v6 格式的完整备份");
      return base;
    }
    const terms = timetableRecords<Term>(candidate.terms, 100, record => {
      for (const key of ["name", "startDate", "endDate", "timeZone"]) textField(record, key, true, 200);
      validateTerm(record as unknown as Term);
    });
    if (terms.filter(term => term.isActive).length > 1) throw new Error("只能有一个当前学期");
    const recurrenceRules = timetableRecords<RecurrenceRule>(candidate.recurrenceRules, 2_000, record => {
      for (const key of ["courseId", "startTime", "endTime"]) textField(record, key, true, 512);
      timestamp(record, "deletedAt");
      const course = base.courses.find(course => course.id === record.courseId);
      const term = course && terms.find(term => term.id === course.termId);
      if (!course || !term) throw new Error("排课规则缺少对应课程或学期");
      if (record.deletedAt) validateRuleShape(record as unknown as RecurrenceRule);
      else validateRule(record as unknown as RecurrenceRule, term);
    });
    const keys = new Set<string>();
    const occurrenceExceptions = timetableRecords<OccurrenceException>(candidate.occurrenceExceptions, 10_000, record => {
      for (const key of ["ruleId", "originalDate"]) textField(record, key, true, 512);
      timestamp(record, "replacementStartAt"); timestamp(record, "replacementEndAt");
      const rule = recurrenceRules.find(rule => rule.id === record.ruleId);
      const course = rule && base.courses.find(course => course.id === rule.courseId);
      const term = course && terms.find(term => term.id === course.termId);
      if (!rule || !term) throw new Error("单次调整缺少对应排课规则");
      const key = `${rule.id}\0${record.originalDate}`;
      if (keys.has(key)) throw new Error("同一课次存在重复调整"); keys.add(key);
      // Retired schedules remain portable even after the active semester dates change.
      if (rule.deletedAt) validateExceptionShape(record as unknown as OccurrenceException);
      else validateException(record as unknown as OccurrenceException, rule, term);
    });
    const referenced = new Set<string>();
    const byId = new Map(base.items.map(item => [item.id, item]));
    for (const item of base.items) {
      if (!item.repeatNextId) continue;
      if (referenced.has(item.repeatNextId)) throw new Error("重复待办存在重复的下一次关联");
      referenced.add(item.repeatNextId);
      if (!byId.has(item.repeatNextId)) throw new Error("重复待办缺少下一次记录");
    }
    // A successor chain may be long, but must never cycle; iterative traversal avoids stack overflow.
    const checked = new Set<string>();
    for (const item of base.items) {
      const path = new Set<string>(); let cursor: Item | undefined = item;
      while (cursor && !checked.has(cursor.id)) {
        if (path.has(cursor.id)) throw new Error("重复待办存在循环关联");
        path.add(cursor.id); cursor = cursor.repeatNextId ? byId.get(cursor.repeatNextId) : undefined;
      }
      for (const id of path) checked.add(id);
    }
    if (candidate.version === 6) {
      const notebooks = timetableRecords<Notebook>(candidate.notebooks, 1000, record => {
        textField(record, "name", true, 40); nameNotebook(record.name as string);
        timestamp(record, "createdAt", true); timestamp(record, "updatedAt", true); timestamp(record, "deletedAt");
        if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) throw new Error("笔记本版本无效");
      });
      const assets = timetableRecords<NoteAsset>(candidate.assets, 2000, record => validateAsset(record as unknown as NoteAsset));
      const assetIds = new Set(assets.map(asset => asset.id));
      const bookIds = new Set(notebooks.filter(book => !book.deletedAt).map(book => book.id));
      for (const item of base.items) {
        if (item.notebookId && !bookIds.has(item.notebookId)) throw new Error("备份缺少对应笔记本");
        for (const id of documentReferences(item.document).assets) if (!assetIds.has(id)) throw new Error("备份缺少正文中的图片");
      }
      return { ...base, version: 6, terms, recurrenceRules, occurrenceExceptions, notebooks, assets };
    }
    if (base.items.some(item => item.notebookId || documentReferences(item.document).assets.size)) throw new Error("笔记本与图片需要 v6 格式的完整备份");
    return { ...base, version: candidate.version as 3 | 4 | 5, terms, recurrenceRules, occurrenceExceptions };
  }

  if ((candidate.version === undefined || candidate.version === 1) && Array.isArray(candidate.entries)) {
    if (candidate.entries.length > 20_000) throw new Error("单次最多导入 20,000 条记录");
    const items: Item[] = [];
    const courses: Course[] = [];
    candidate.entries.forEach((value, index) => {
      const record = object(value);
      for (const key of ["id", "text", "date", "time", "createdAt"]) textField(record, key);
      if (record.type !== undefined && !["note", "task", "schedule", "course"].includes(String(record.type))) throw new Error("旧备份记录类型无效");
      if (record.done !== undefined && typeof record.done !== "boolean") throw new Error("旧备份状态无效");
      if (record.date && !isCalendarDate(String(record.date))) throw new Error("旧备份日期无效");
      if (record.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(record.time))) throw new Error("旧备份时间无效");
      const entry = record as LegacyEntry;
      const converted = legacyEntryToRecord(entry, index);
      if ("kind" in converted) items.push(converted); else courses.push(converted);
    });
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      theme: typeof candidate.theme === "string" ? candidate.theme : "sage",
      glass: typeof candidate.glass === "boolean" ? candidate.glass : true,
      items: records<Item>(items),
      courses: records<Course>(courses, true),
    };
  }

  throw new Error("备份文件缺少可识别的记录数据。");
}

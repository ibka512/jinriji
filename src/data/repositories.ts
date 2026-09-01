import type { BackupPayload, Course, Item, TimetableData, LibraryData } from "../domain/models";
import type { JinrijiDatabase } from "./database";
import { nextRepeatSchedule, normalizeTags, validateOrganization } from "../domain/organization";
import { documentText, validateDocument } from "../domain/note-document";

export interface CreateItemInput {
  title: string;
  body?: string;
  document?: Item["document"];
  notebookId?: string;
  sourceNoteId?: string;
  kind: Item["kind"];
  dueAt?: string;
  startAt?: string;
  allDay?: boolean;
  dateOnly?: string;
  courseId?: string;
  pinned?: boolean;
  tags?: string[];
  repeat?: Item["repeat"];
}

export interface CreateCourseInput {
  name: string;
  firstMeetingAt?: string;
  allDay?: boolean;
  dateOnly?: string;
  location?: string;
  instructor?: string;
}

export type ItemChanges = Partial<Pick<Item, "title" | "body" | "document" | "notebookId" | "sourceNoteId" | "kind" | "status" | "dueAt" | "startAt" | "allDay" | "dateOnly" | "deletedAt" | "courseId" | "pinned" | "tags" | "repeat">>;
export type BulkAction = "pin" | "unpin" | "tag" | "complete" | "delete" | "notebook";
export type CourseChanges = Partial<Pick<Course, "name" | "firstMeetingAt" | "allDay" | "dateOnly" | "deletedAt" | "location" | "instructor">>;
export interface RecoveryPoint { savedAt: string; payload: BackupPayload }
export const RECOVERY_KEY = "recovery:v0.5";

export class AppRepository {
  constructor(private readonly database: JinrijiDatabase) {}

  async allRecords(): Promise<{ items: Item[]; courses: Course[] } & TimetableData & LibraryData> {
    return this.database.transaction("r", [this.database.items, this.database.courses, this.database.terms, this.database.recurrenceRules, this.database.occurrenceExceptions, this.database.notebooks, this.database.assets], async () => ({
      items: await this.database.items.toArray(), courses: await this.database.courses.toArray(),
      terms: await this.database.terms.toArray(), recurrenceRules: await this.database.recurrenceRules.toArray(), occurrenceExceptions: await this.database.occurrenceExceptions.toArray(),
      notebooks: await this.database.notebooks.toArray(), assets: await this.database.assets.toArray(),
    }));
  }

  async listItems(): Promise<Item[]> {
    const items = await this.database.items.toArray();
    return items.filter((item) => !item.deletedAt).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listCourses(): Promise<Course[]> {
    const courses = await this.database.courses.toArray();
    return courses.filter((course) => !course.deletedAt).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createItem(input: CreateItemInput, id: string = crypto.randomUUID()): Promise<Item> {
    if (input.document) validateDocument(input.document);
    const now = new Date().toISOString();
    const item: Item = {
      id,
      kind: input.kind,
      title: input.title,
      body: input.document ? documentText(input.document) : input.body ?? input.title,
      document: input.document,
      notebookId: input.notebookId,
      sourceNoteId: input.sourceNoteId,
      status: "open",
      dueAt: input.dueAt,
      startAt: input.startAt,
      allDay: input.allDay ?? false,
      dateOnly: input.dateOnly,
      courseId: input.courseId,
      pinned: input.pinned,
      tags: input.tags ? normalizeTags(input.tags) : undefined,
      repeat: input.repeat,
      reminderOffsets: [],
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    validateOrganization(item);
    await this.database.items.add(item);
    return item;
  }

  async createCourse(input: CreateCourseInput, id: string = crypto.randomUUID()): Promise<Course> {
    const now = new Date().toISOString();
    const course: Course = {
      id,
      name: input.name,
      firstMeetingAt: input.firstMeetingAt,
      allDay: input.allDay,
      dateOnly: input.dateOnly,
      location: input.location,
      instructor: input.instructor,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    await this.database.courses.add(course);
    return course;
  }

  async updateItem(id: string, changes: ItemChanges, expectedRevision?: number): Promise<Item | undefined> {
    return this.database.transaction("rw", this.database.items, async () => {
      const current = await this.database.items.get(id);
      if (!current) return undefined;
      if (expectedRevision !== undefined && (current.revision !== expectedRevision || current.deletedAt)) {
        throw new Error("原记录已变动，草稿仍保留。请重新打开记录，或另存为新记录。");
      }
      const now = new Date().toISOString();
      const completedAt = changes.status === "completed" && current.status !== "completed" ? now
        : changes.status === "open" ? undefined : current.completedAt;
      const updated: Item = { ...current, ...changes, completedAt, updatedAt: now, revision: current.revision + 1 };
      // A text projection is not a replacement for a structured source document.
      if (changes.body !== undefined && changes.document === undefined && current.document && changes.body !== current.body) {
        throw new Error("此记录包含格式内容，请使用正文编辑器修改；原文未改变。");
      }
      if (updated.document) { validateDocument(updated.document); updated.body = documentText(updated.document); }
      if (updated.kind !== "task") updated.repeat = undefined;
      if (changes.tags) updated.tags = normalizeTags(changes.tags);
      validateOrganization(updated);
      if (changes.status === "completed" && current.status === "open" && updated.repeat && !current.deletedAt) {
        if (current.repeatNextId) throw new Error("此待办已有下一次，请刷新后查看");
        const next: Item = { ...updated, ...nextRepeatSchedule(updated, new Date(now)), id: crypto.randomUUID(), status: "open", completedAt: undefined,
          repeatNextId: undefined, createdAt: now, updatedAt: now, revision: 1 };
        await this.database.items.add(next);
        updated.repeatNextId = next.id;
      }
      if (changes.status === "open" && current.status === "completed" && current.repeatNextId) {
        const next = await this.database.items.get(current.repeatNextId);
        if (next && (next.revision !== 1 || next.status !== "open" || next.deletedAt)) throw new Error("下一次待办已修改，不能撤销此次完成。请在下一次待办中继续处理。");
        // This is the untouched auto-generated successor, removed only when explicitly undoing completion.
        if (next) await this.database.items.delete(next.id);
        updated.repeatNextId = undefined;
      }
      await this.database.items.put(updated);
      return updated;
    });
  }

  async updateCourse(id: string, changes: CourseChanges, expectedRevision?: number): Promise<Course | undefined> {
    return this.database.transaction("rw", this.database.courses, async () => {
      const current = await this.database.courses.get(id);
      if (!current) return undefined;
      if (expectedRevision !== undefined && (current.revision !== expectedRevision || current.deletedAt)) {
        throw new Error("原课程已变动，草稿仍保留。请重新打开课程，或另存为新记录。");
      }
      const updated = { ...current, ...changes, updatedAt: new Date().toISOString(), revision: current.revision + 1 };
      await this.database.courses.put(updated);
      return updated;
    });
  }

  async softDeleteItem(id: string): Promise<Item | undefined> {
    return this.updateItem(id, { deletedAt: new Date().toISOString() });
  }

  async organizeItems(records: { id: string; revision: number }[], action: BulkAction, tags: string[] = [], notebookId?: string): Promise<number> {
    if (!records.length) return 0;
    if (new Set(records.map(item => item.id)).size !== records.length) throw new Error("选择中包含重复记录");
    const additions = normalizeTags(tags);
    if (action === "tag" && !additions.length) throw new Error("请输入标签");
    return this.database.transaction("rw", [this.database.items, this.database.notebooks], async () => {
      if (action === "notebook" && notebookId) {
        const book = await this.database.notebooks.get(notebookId);
        if (!book || book.deletedAt) throw new Error("笔记本已变动，请重新选择");
      }
      let count = 0;
      for (const selected of records) {
        const current = await this.database.items.get(selected.id);
        if (!current || current.deletedAt || current.revision !== selected.revision) throw new Error("部分记录已变动，本次整理未保存。请重新选择后重试。");
        if (action === "notebook" && current.kind !== "note") throw new Error("请只选择笔记后移动；本次未作修改。");
        if (action === "complete" && (current.kind !== "task" || current.status !== "open")) continue;
        const changes: ItemChanges = action === "pin" ? { pinned: true } : action === "unpin" ? { pinned: false }
          : action === "tag" ? { tags: normalizeTags([...(current.tags || []), ...additions]) }
          : action === "complete" ? { status: "completed" } : action === "notebook" ? { notebookId: notebookId || undefined } : { deletedAt: new Date().toISOString() };
        await this.updateItem(current.id, changes, selected.revision); count++;
      }
      return count;
    });
  }

  /** Derive an editable task without mutating the source note or its attachments. */
  async createLinkedTask(noteId: string, expectedRevision: number): Promise<Item> {
    return this.database.transaction("rw", this.database.items, async () => {
      const note = await this.database.items.get(noteId);
      if (!note || note.deletedAt || note.kind !== "note" || note.revision !== expectedRevision) throw new Error("来源笔记已变动，请重新打开");
      return this.createItem({ kind: "task", title: note.title, body: note.title, sourceNoteId: note.id, courseId: note.courseId, tags: note.tags });
    });
  }

  async restoreItem(id: string): Promise<Item | undefined> {
    return this.updateItem(id, { deletedAt: undefined });
  }

  async replaceData(items: Item[], courses: Course[]): Promise<void> {
    await this.database.transaction("rw", this.database.items, this.database.courses, async () => {
      await this.database.items.clear();
      await this.database.courses.clear();
      if (items.length) await this.database.items.bulkPut(items);
      if (courses.length) await this.database.courses.bulkPut(courses);
    });
  }

  /** Snapshot, replacement and imported settings commit together or not at all. */
  async importBackup(payload: BackupPayload): Promise<void> {
    await this.database.transaction("rw", [this.database.items, this.database.courses, this.database.settings, this.database.terms, this.database.recurrenceRules, this.database.occurrenceExceptions, this.database.notebooks, this.database.assets], async () => {
      await this.replaceWithRecovery(payload);
    });
  }

  async restoreRecovery(): Promise<boolean> {
    return this.database.transaction("rw", [this.database.items, this.database.courses, this.database.settings, this.database.terms, this.database.recurrenceRules, this.database.occurrenceExceptions, this.database.notebooks, this.database.assets], async () => {
      const point = await this.database.settings.get(RECOVERY_KEY);
      if (!point) return false;
      await this.replaceWithRecovery((point.value as RecoveryPoint).payload);
      return true;
    });
  }

  private async replaceWithRecovery(payload: BackupPayload): Promise<void> {
    const now = new Date().toISOString();
    const theme = await this.database.settings.get("theme");
    const recovery: RecoveryPoint = {
      savedAt: now,
      payload: { version: 6, exportedAt: now, theme: typeof theme?.value === "string" ? theme.value : "sage", glass: true,
        notebooks: await this.database.notebooks.toArray(), assets: await this.database.assets.toArray(),
        items: await this.database.items.toArray(), courses: await this.database.courses.toArray(),
        terms: await this.database.terms.toArray(), recurrenceRules: await this.database.recurrenceRules.toArray(), occurrenceExceptions: await this.database.occurrenceExceptions.toArray() },
    };
    await this.database.settings.put({ key: RECOVERY_KEY, value: recovery, updatedAt: now });
    await this.database.notebooks.clear();
    if (payload.version === 6) {
      const previousBooks = new Map(recovery.payload.version === 6 ? recovery.payload.notebooks.map(book => [book.id, book.revision]) : []);
      await this.database.notebooks.bulkPut(payload.notebooks.map(book => ({ ...book, revision: Math.max(book.revision, previousBooks.get(book.id) || 0) + 1 })));
      // Retain unreferenced assets for local drafts/history; never overwrite a different image.
      for (const asset of payload.assets) {
        const existing = await this.database.assets.get(asset.id);
        if (existing && existing.dataUrl !== asset.dataUrl) throw new Error("图片 ID 冲突，未导入；原数据不受影响");
        await this.database.assets.put(asset);
      }
    }
    await this.database.items.clear();
    await this.database.courses.clear();
    // An older backup intentionally replaces the full snapshot, not a partial graph.
    for (const table of [this.database.terms, this.database.recurrenceRules, this.database.occurrenceExceptions]) await table.clear();
    if (payload.version !== 2) {
      const previous = recovery.payload.version !== 2 ? recovery.payload : undefined;
      const bump = <T extends { id: string; revision?: number }>(values: T[], old: T[] = []): T[] => {
        const versions = new Map(old.map(value => [value.id, value.revision ?? 0]));
        return values.map(value => ({ ...value, revision: Math.max(value.revision ?? 0, versions.get(value.id) ?? 0) + 1 }));
      };
      await this.database.terms.bulkPut(bump(payload.terms, previous?.terms));
      await this.database.recurrenceRules.bulkPut(bump(payload.recurrenceRules, previous?.recurrenceRules));
      await this.database.occurrenceExceptions.bulkPut(bump(payload.occurrenceExceptions, previous?.occurrenceExceptions));
    }
    // Bump matching revisions so an editor in another tab cannot overwrite imported content.
    const previous = new Map(recovery.payload.items.map(item => [item.id, item.revision]));
    const previousCourses = new Map(recovery.payload.courses.map(course => [course.id, course.revision]));
    if (payload.items.length) await this.database.items.bulkPut(payload.items.map(item => ({ ...item, revision: Math.max(item.revision, previous.get(item.id) ?? 0) + 1 })));
    if (payload.courses.length) await this.database.courses.bulkPut(payload.courses.map(course => ({ ...course, revision: Math.max(course.revision, previousCourses.get(course.id) ?? 0) + 1 })));
    await this.database.settings.bulkPut([
      { key: "theme", value: payload.theme, updatedAt: now },
      { key: "glass", value: payload.glass, updatedAt: now },
    ]);
  }
}

export class SettingsRepository {
  constructor(private readonly database: JinrijiDatabase) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const setting = await this.database.settings.get(key);
    return setting ? (setting.value as T) : fallback;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.database.settings.put({ key, value, updatedAt: new Date().toISOString() });
  }
}

import type { TaskRepeat } from "../domain/models";
import type { NoteDocument } from "../domain/note-document";
export type ComposeType = "note" | "task" | "schedule" | "course";
export interface Draft {
  key: string;
  entity?: "item" | "course";
  id?: string;
  revision?: number;
  type: ComposeType;
  title: string;
  body: string;
  document?: NoteDocument;
  notebookId?: string;
  cursor?: number;
  scroll?: number;
  date: string;
  time: string;
  updatedAt: string;
  courseId?: string;
  location?: string;
  instructor?: string;
  tagsText?: string;
  repeatFrequency?: "" | TaskRepeat["frequency"];
  repeat?: TaskRepeat;
  repeatSourceDate?: string;
}

export const DRAFT_KEY = "jinriji:drafts:v1";

export class DraftStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem">) {}

  list(): Draft[] {
    const raw = this.storage.getItem(DRAFT_KEY);
    if (!raw) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) throw new Error("草稿格式无法读取，请先备份浏览器数据");
    if (!values.every(value => value && typeof value === "object" &&
      ["key", "title", "body", "date", "time", "updatedAt"].every(key => typeof value[key] === "string") &&
      ["note", "task", "schedule", "course"].includes(value.type) &&
      (value.id === undefined || typeof value.id === "string") &&
      ["courseId", "location", "instructor", "tagsText", "repeatSourceDate"].every(key => value[key] === undefined || typeof value[key] === "string") &&
      (value.repeatFrequency === undefined || ["", "daily", "weekly", "monthly"].includes(value.repeatFrequency)) &&
      (value.repeat === undefined || value.repeat && typeof value.repeat === "object" && ["frequency", "anchorDate", "timeZone"].every(key => typeof value.repeat[key] === "string")) &&
      (value.entity === undefined || ["item", "course"].includes(value.entity)) &&
      (value.revision === undefined || Number.isSafeInteger(value.revision)))) throw new Error("草稿格式无法读取，请先备份浏览器数据");
    return (values as Draft[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(key: string): Draft | undefined { return this.list().find(draft => draft.key === key); }

  save(draft: Draft): void {
    const drafts = this.list().filter(value => value.key !== draft.key);
    this.storage.setItem(DRAFT_KEY, JSON.stringify([draft, ...drafts]));
  }

  remove(key: string): void {
    this.storage.setItem(DRAFT_KEY, JSON.stringify(this.list().filter(value => value.key !== key)));
  }
}

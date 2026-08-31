import Dexie, { type EntityTable } from "dexie";
import type { Draft } from "./drafts";
import type { NoteVersion } from "./writing-repository";
import type { Notebook, NoteAsset } from "../domain/notebooks";
import type {
  AppSetting,
  Course,
  Item,
  MigrationRecord,
  OccurrenceException,
  RecurrenceRule,
  Term,
} from "../domain/models";

export class JinrijiDatabase extends Dexie {
  items!: EntityTable<Item, "id">;
  courses!: EntityTable<Course, "id">;
  terms!: EntityTable<Term, "id">;
  recurrenceRules!: EntityTable<RecurrenceRule, "id">;
  occurrenceExceptions!: EntityTable<OccurrenceException, "id">;
  settings!: EntityTable<AppSetting, "key">;
  migrations!: EntityTable<MigrationRecord, "id">;
  drafts!: EntityTable<Draft, "key">;
  noteVersions!: EntityTable<NoteVersion, "id">;
  notebooks!: EntityTable<Notebook, "id">;
  assets!: EntityTable<NoteAsset, "id">;

  constructor(name = "jinriji") {
    super(name);
    this.version(1).stores({
      items: "&id, kind, status, createdAt, updatedAt, dueAt, startAt, courseId, deletedAt",
      courses: "&id, name, termId, updatedAt, deletedAt",
      terms: "&id, startDate, endDate, isActive",
      recurrenceRules: "&id, courseId, weekday, startWeek, endWeek",
      occurrenceExceptions: "&id, ruleId, originalDate, kind",
      settings: "&key, updatedAt",
      migrations: "&id, completedAt",
    });
    this.version(2).stores({ drafts: "&key, id, updatedAt", noteVersions: "&id, itemId, savedAt" });
    this.version(3).stores({ notebooks: "&id, name, updatedAt", assets: "&id, createdAt" });
  }
}

export const db = new JinrijiDatabase();

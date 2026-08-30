import Dexie, { type EntityTable } from "dexie";
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
  }
}

export const db = new JinrijiDatabase();

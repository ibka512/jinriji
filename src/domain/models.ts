import type { NoteDocument } from "./note-document";
import type { Notebook, NoteAsset } from "./notebooks";
export type ItemKind = "note" | "task" | "event";
export type ItemStatus = "open" | "completed" | "archived";
export interface TaskRepeat { frequency: "daily" | "weekly" | "monthly"; anchorDate: string; timeZone: string }

export interface Item {
  id: string;
  kind: ItemKind;
  title: string;
  body: string;
  document?: NoteDocument;
  notebookId?: string;
  sourceNoteId?: string;
  status: ItemStatus;
  courseId?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  allDay: boolean;
  /** Calendar date for all-day entries; older records fall back to their timestamp. */
  dateOnly?: string;
  completedAt?: string;
  pinned?: boolean;
  tags?: string[];
  repeat?: TaskRepeat;
  repeatNextId?: string;
  reminderOffsets: number[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  revision: number;
}

export interface Course {
  id: string;
  name: string;
  instructor?: string;
  location?: string;
  color?: string;
  termId?: string;
  firstMeetingAt?: string;
  allDay?: boolean;
  dateOnly?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  revision: number;
}

export interface Term {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  totalWeeks: number;
  isActive: boolean;
  revision?: number;
}

export interface RecurrenceRule {
  id: string;
  courseId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  startWeek: number;
  endWeek: number;
  intervalWeeks: 1 | 2;
  location?: string;
  deletedAt?: string;
  revision?: number;
}

export interface OccurrenceException {
  id: string;
  ruleId: string;
  originalDate: string;
  kind: "cancelled" | "rescheduled";
  replacementStartAt?: string;
  replacementEndAt?: string;
  replacementLocation?: string;
  revision?: number;
}

export interface AppSetting<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
}

export interface MigrationRecord {
  id: string;
  completedAt: string;
  sourceCount: number;
  itemCount: number;
  courseCount: number;
}

export interface LegacyEntry {
  id?: string;
  text?: string;
  type?: "note" | "task" | "schedule" | "course";
  date?: string;
  time?: string;
  done?: boolean;
  createdAt?: string;
}

export interface BackupPayloadV2 {
  version: 2;
  exportedAt: string;
  theme: string;
  glass: boolean;
  items: Item[];
  courses: Course[];
}

export interface TimetableData {
  terms: Term[];
  recurrenceRules: RecurrenceRule[];
  occurrenceExceptions: OccurrenceException[];
}
export interface BackupPayloadV3 extends Omit<BackupPayloadV2, "version">, TimetableData { version: 3 }
export interface BackupPayloadV4 extends Omit<BackupPayloadV3, "version"> { version: 4 }
export interface BackupPayloadV5 extends Omit<BackupPayloadV4, "version"> { version: 5 }
export interface LibraryData { notebooks: Notebook[]; assets: NoteAsset[] }
export interface BackupPayloadV6 extends Omit<BackupPayloadV5, "version">, LibraryData { version: 6 }
export type BackupPayload = BackupPayloadV2 | BackupPayloadV3 | BackupPayloadV4 | BackupPayloadV5 | BackupPayloadV6;

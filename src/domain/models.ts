export type ItemKind = "note" | "task" | "event";
export type ItemStatus = "open" | "completed" | "archived";

export interface Item {
  id: string;
  kind: ItemKind;
  title: string;
  body: string;
  status: ItemStatus;
  courseId?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  allDay: boolean;
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
}

export interface OccurrenceException {
  id: string;
  ruleId: string;
  originalDate: string;
  kind: "cancelled" | "rescheduled";
  replacementStartAt?: string;
  replacementEndAt?: string;
  replacementLocation?: string;
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

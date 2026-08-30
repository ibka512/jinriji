import type { Course, Item } from "../domain/models";
import type { JinrijiDatabase } from "./database";

export interface CreateItemInput {
  title: string;
  kind: Item["kind"];
  dueAt?: string;
  startAt?: string;
  allDay?: boolean;
}

export interface CreateCourseInput {
  name: string;
  firstMeetingAt?: string;
}

export class AppRepository {
  constructor(private readonly database: JinrijiDatabase) {}

  async listItems(): Promise<Item[]> {
    const items = await this.database.items.toArray();
    return items.filter((item) => !item.deletedAt).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listCourses(): Promise<Course[]> {
    const courses = await this.database.courses.toArray();
    return courses.filter((course) => !course.deletedAt).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    const now = new Date().toISOString();
    const item: Item = {
      id: crypto.randomUUID(),
      kind: input.kind,
      title: input.title,
      body: input.title,
      status: "open",
      dueAt: input.dueAt,
      startAt: input.startAt,
      allDay: input.allDay ?? false,
      reminderOffsets: [],
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    await this.database.items.add(item);
    return item;
  }

  async createCourse(input: CreateCourseInput): Promise<Course> {
    const now = new Date().toISOString();
    const course: Course = {
      id: crypto.randomUUID(),
      name: input.name,
      firstMeetingAt: input.firstMeetingAt,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    await this.database.courses.add(course);
    return course;
  }

  async updateItem(id: string, changes: Partial<Pick<Item, "kind" | "status" | "deletedAt">>): Promise<Item | undefined> {
    const current = await this.database.items.get(id);
    if (!current) return undefined;
    const updated: Item = {
      ...current,
      ...changes,
      updatedAt: new Date().toISOString(),
      revision: current.revision + 1,
    };
    await this.database.items.put(updated);
    return updated;
  }

  async softDeleteItem(id: string): Promise<Item | undefined> {
    return this.updateItem(id, { deletedAt: new Date().toISOString() });
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

import type { JinrijiDatabase } from "./database";
import type { Course, Item, LegacyEntry } from "../domain/models";
import { legacyEntryToRecord } from "./legacy-conversion";

const MIGRATION_ID = "local-storage-v1";
const LEGACY_ENTRIES_KEY = "jinriji:entries";
const BACKUP_KEY = "jinriji:migration-backup:v1";
const MIGRATED_KEY = "jinriji:migrated:v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export interface MigrationResult {
  migrated: boolean;
  sourceCount: number;
  itemCount: number;
  courseCount: number;
}

export async function migrateLocalStorage(database: JinrijiDatabase, storage: StorageLike): Promise<MigrationResult> {
  const completed = await database.migrations.get(MIGRATION_ID);
  if (completed) {
    return {
      migrated: false,
      sourceCount: completed.sourceCount,
      itemCount: completed.itemCount,
      courseCount: completed.courseCount,
    };
  }

  const raw = storage.getItem(LEGACY_ENTRIES_KEY);
  if (raw !== null && storage.getItem(BACKUP_KEY) === null) storage.setItem(BACKUP_KEY, raw);

  let legacyEntries: LegacyEntry[] = [];
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("旧版数据格式无效，已停止迁移并保留原始数据。");
    legacyEntries = parsed as LegacyEntry[];
  }

  const now = new Date().toISOString();
  const items: Item[] = [];
  const courses: Course[] = [];
  legacyEntries.forEach((entry, index) => {
    const converted = legacyEntryToRecord(entry, index, now);
    if ("kind" in converted) items.push(converted); else courses.push(converted);
  });

  await database.transaction("rw", database.items, database.courses, database.settings, database.migrations, async () => {
    if (items.length) await database.items.bulkPut(items);
    if (courses.length) await database.courses.bulkPut(courses);
    const theme = storage.getItem("jinriji:theme");
    const glass = storage.getItem("jinriji:glass");
    if (theme) await database.settings.put({ key: "theme", value: theme, updatedAt: now });
    if (glass) await database.settings.put({ key: "glass", value: glass !== "off", updatedAt: now });
    await database.migrations.put({
      id: MIGRATION_ID,
      completedAt: now,
      sourceCount: legacyEntries.length,
      itemCount: items.length,
      courseCount: courses.length,
    });
  });

  storage.setItem(MIGRATED_KEY, now);
  return { migrated: true, sourceCount: legacyEntries.length, itemCount: items.length, courseCount: courses.length };
}

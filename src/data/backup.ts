import type { BackupPayloadV2, Course, Item, LegacyEntry } from "../domain/models";
import { legacyEntryToRecord } from "./legacy-conversion";

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

export function parseBackup(raw: string): BackupPayloadV2 {
  const payload: unknown = JSON.parse(raw);
  if (!payload || typeof payload !== "object") throw new Error("备份文件不是有效对象。");
  const candidate = payload as Record<string, unknown>;

  if (candidate.version === 2 && Array.isArray(candidate.items) && Array.isArray(candidate.courses)) {
    return candidate as unknown as BackupPayloadV2;
  }

  if (Array.isArray(candidate.entries)) {
    const items: Item[] = [];
    const courses: Course[] = [];
    (candidate.entries as LegacyEntry[]).forEach((entry, index) => {
      const converted = legacyEntryToRecord(entry, index);
      if ("kind" in converted) items.push(converted); else courses.push(converted);
    });
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      theme: typeof candidate.theme === "string" ? candidate.theme : "sage",
      glass: typeof candidate.glass === "boolean" ? candidate.glass : true,
      items,
      courses,
    };
  }

  throw new Error("备份文件缺少可识别的记录数据。");
}

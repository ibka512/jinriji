import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { JinrijiDatabase } from "../../src/data/database";
import { migrateLocalStorage, type StorageLike } from "../../src/data/migrate-local-storage";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const databases: JinrijiDatabase[] = [];

function createDatabase(): JinrijiDatabase {
  const database = new JinrijiDatabase(`jinriji-test-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("localStorage migration", () => {
  it("backs up and converts legacy items and courses exactly once", async () => {
    const database = createDatabase();
    const storage = new MemoryStorage();
    const legacy = [
      { id: "n1", text: "一条笔记", type: "note", createdAt: "2026-08-01T08:00:00.000Z" },
      { id: "t1", text: "交作业", type: "task", date: "2026-08-30", time: "13:30", done: true },
      { id: "c1", text: "设计史", type: "course", date: "2026-08-31", time: "10:00" },
    ];
    const raw = JSON.stringify(legacy);
    storage.setItem("jinriji:entries", raw);
    storage.setItem("jinriji:theme", "aizome");

    const first = await migrateLocalStorage(database, storage);
    const second = await migrateLocalStorage(database, storage);

    expect(first).toMatchObject({ migrated: true, sourceCount: 3, itemCount: 2, courseCount: 1 });
    expect(second).toMatchObject({ migrated: false, sourceCount: 3, itemCount: 2, courseCount: 1 });
    expect(storage.getItem("jinriji:migration-backup:v1")).toBe(raw);
    expect(storage.getItem("jinriji:entries")).toBe(raw);
    expect(await database.items.count()).toBe(2);
    expect(await database.courses.count()).toBe(1);
    expect((await database.items.get("t1"))?.status).toBe("completed");
    expect((await database.settings.get("theme"))?.value).toBe("aizome");
  });

  it("stops without a migration marker when legacy JSON is invalid", async () => {
    const database = createDatabase();
    const storage = new MemoryStorage();
    storage.setItem("jinriji:entries", "{invalid");

    await expect(migrateLocalStorage(database, storage)).rejects.toThrow();
    expect(await database.migrations.count()).toBe(0);
    expect(storage.getItem("jinriji:migration-backup:v1")).toBe("{invalid");
  });
});

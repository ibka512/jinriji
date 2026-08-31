import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { JinrijiDatabase } from "../../src/data/database";
import { AppRepository, RECOVERY_KEY, SettingsRepository, type RecoveryPoint } from "../../src/data/repositories";
import { createBackup } from "../../src/data/backup";

const databases: JinrijiDatabase[] = [];

function setup(): { database: JinrijiDatabase; repository: AppRepository } {
  const database = new JinrijiDatabase(`jinriji-repository-${crypto.randomUUID()}`);
  databases.push(database);
  return { database, repository: new AppRepository(database) };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("AppRepository", () => {
  it("edits in place, preserves unrelated fields and detects conflicting drafts", async () => {
    const { repository } = setup();
    const item = await repository.createItem({ title: "标题", body: "正文", kind: "note" });
    await repository.updateItem(item.id, { title: "新标题", body: "新正文" }, item.revision);
    const result = await repository.listItems();
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ id: item.id, body: "新正文", createdAt: item.createdAt });
    await expect(repository.updateItem(item.id, { body: "过期草稿" }, item.revision)).rejects.toThrow("已变动");
    expect((await repository.listItems())[0]?.body).toBe("新正文");
  });
  it("persists course edits and keeps deleted courses recoverable", async () => {
    const { repository } = setup();
    const course = await repository.createCourse({ name: "课程" });
    await repository.updateCourse(course.id, { name: "更名", deletedAt: new Date().toISOString() }, 1);
    expect(await repository.listCourses()).toHaveLength(0);
    expect((await repository.allRecords()).courses).toHaveLength(1);
    await repository.updateCourse(course.id, { deletedAt: undefined });
    expect((await repository.listCourses())[0]?.name).toBe("更名");
  });
  it("keeps completion timestamps stable and clears them on reopening", async () => {
    const { repository } = setup();
    const item = await repository.createItem({ title: "待办", kind: "task" });
    const first = await repository.updateItem(item.id, { status: "completed" });
    const second = await repository.updateItem(item.id, { status: "completed" });
    expect(first?.completedAt).toBeTruthy(); expect(second?.completedAt).toBe(first?.completedAt);
    expect((await repository.updateItem(item.id, { status: "open" }))?.completedAt).toBeUndefined();
  });
  it("imports with a recovery point including deleted records and restores both data and theme", async () => {
    const { repository, database } = setup(); const settings = new SettingsRepository(database);
    await settings.set("theme", "aizome");
    const item = await repository.createItem({ title: "原记录", kind: "note" });
    await repository.softDeleteItem(item.id);
    await repository.importBackup(createBackup([], [], "sakura", true));
    expect((await repository.allRecords()).items).toHaveLength(0);
    const point = await settings.get<RecoveryPoint | undefined>(RECOVERY_KEY, undefined);
    expect(point?.payload.items[0]?.deletedAt).toBeTruthy();
    expect(await repository.restoreRecovery()).toBe(true);
    expect((await repository.allRecords()).items[0]?.id).toBe(item.id);
    expect(await settings.get("theme", "")).toBe("aizome");
    // The previous imported state becomes the next recovery point.
    await repository.restoreRecovery(); expect((await repository.allRecords()).items).toHaveLength(0);
  });
  it("rolls back every table and the recovery point when replacement fails", async () => {
    const { repository, database } = setup();
    const original = await repository.createItem({ title: "不能丢失", kind: "note" });
    const course = await repository.createCourse({ name: "课程" });
    database.courses.hook("creating", () => { throw new Error("模拟写入失败"); });
    await expect(repository.importBackup(createBackup([], [course], "sakura", true))).rejects.toThrow();
    expect((await repository.listItems())[0]?.id).toBe(original.id);
    expect(await database.settings.get(RECOVERY_KEY)).toBeUndefined();
  });
  it("prevents another tab's draft from overwriting an imported matching ID", async () => {
    const { repository } = setup();
    const item = await repository.createItem({ title: "旧标题", kind: "note" });
    await repository.importBackup(createBackup([{ ...item, title: "导入内容" }], [], "sage", true));
    await expect(repository.updateItem(item.id, { title: "旧编辑器" }, 1)).rejects.toThrow();
    expect((await repository.listItems())[0]?.title).toBe("导入内容");
  });
  it("creates, completes, soft-deletes, and restores an item", async () => {
    const { repository } = setup();
    const item = await repository.createItem({ title: "完成数据层", kind: "task" });

    const completed = await repository.updateItem(item.id, { status: "completed" });
    expect(completed?.status).toBe("completed");
    expect(completed?.revision).toBe(2);

    await repository.softDeleteItem(item.id);
    expect(await repository.listItems()).toHaveLength(0);

    await repository.restoreItem(item.id);
    const restored = await repository.listItems();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.revision).toBe(4);
  });
});

import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JinrijiDatabase } from "../../src/data/database";
import { AppRepository, type CreateItemInput } from "../../src/data/repositories";
import { createFullBackup, parseBackup } from "../../src/data/backup";

const databases: JinrijiDatabase[] = [];
const input: CreateItemInput = { title: "读书", kind: "task", dueAt: "2026-08-30T16:00:00Z", dateOnly: "2026-08-31", allDay: true,
  repeat: { frequency: "daily", anchorDate: "2026-08-31", timeZone: "Asia/Shanghai" }, tags: ["学习"], pinned: true };
async function setup() {
  const db = new JinrijiDatabase(`organization-${crypto.randomUUID()}`); databases.push(db);
  const app = new AppRepository(db); const item = await app.createItem(input); return { db, app, item };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-08-31T04:00:00Z")); });
afterEach(async () => { vi.useRealTimers(); await Promise.all(databases.splice(0).map(db => db.delete())); });

it("creates exactly one successor in the same transaction as completion", async () => {
  const { app, item } = await setup();
  const completed = await app.updateItem(item.id, { status: "completed" }, 1);
  expect(completed?.repeatNextId).toBeTruthy();
  await app.updateItem(item.id, { status: "completed" });
  const all = (await app.allRecords()).items;
  expect(all).toHaveLength(2);
  expect(all.find(value => value.id === completed?.repeatNextId)).toMatchObject({ dateOnly: "2026-09-01", tags: ["学习"], pinned: true, status: "open", revision: 1 });
});
it("serializes competing completions and rejects a stale revision", async () => {
  const { app, item } = await setup();
  const results = await Promise.allSettled([app.updateItem(item.id, { status: "completed" }, 1), app.updateItem(item.id, { status: "completed" }, 1)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect((await app.allRecords()).items).toHaveLength(2);
});
it("undoes completion only while the generated successor is untouched", async () => {
  const { app, db, item } = await setup();
  let completed = await app.updateItem(item.id, { status: "completed" }, 1);
  await app.updateItem(item.id, { status: "open" }, completed!.revision);
  expect(await db.items.count()).toBe(1);
  completed = await app.updateItem(item.id, { status: "completed" });
  await app.updateItem(completed!.repeatNextId!, { body: "补充笔记" }, 1);
  await expect(app.updateItem(item.id, { status: "open" })).rejects.toThrow("下一次待办已修改");
  expect((await db.items.get(item.id))?.status).toBe("completed");
});
it("rolls completion back if successor creation fails", async () => {
  const { app, db, item } = await setup();
  db.items.hook("creating", () => { throw new Error("模拟空间不足"); });
  await expect(app.updateItem(item.id, { status: "completed" })).rejects.toThrow("空间不足");
  expect(await db.items.toArray()).toEqual([item]);
});
it("clears repetition on kind conversion and preserves other metadata", async () => {
  const { app, item } = await setup();
  const note = await app.updateItem(item.id, { kind: "note" }, 1);
  expect(note?.repeat).toBeUndefined(); expect(note?.tags).toEqual(["学习"]); expect(note?.pinned).toBe(true);
});
it("keeps normal tasks normal, and stopping repetition prevents successors", async () => {
  const { app, db, item } = await setup();
  await app.updateItem(item.id, { repeat: undefined }); await app.updateItem(item.id, { status: "completed" });
  expect(await db.items.count()).toBe(1);
});
it("rolls back all bulk changes when a later selection is stale", async () => {
  const { app, db, item } = await setup(); const other = await app.createItem({ title: "另一条", kind: "note" });
  await app.updateItem(other.id, { body: "其他标签页改动" });
  await expect(app.organizeItems([item, other], "unpin")).rejects.toThrow("本次整理未保存");
  expect((await db.items.get(item.id))?.pinned).toBe(true); expect((await db.items.get(item.id))?.revision).toBe(1);
});
it("applies tags atomically and never exceeds the per-record tag limit", async () => {
  const { app, db, item } = await setup(); const other = await app.createItem({ title: "另一条", kind: "note", tags: Array.from({ length: 12 }, (_, i) => String(i)) });
  await expect(app.organizeItems([item, other], "tag", ["新增"])).rejects.toThrow("12");
  expect((await db.items.get(item.id))?.tags).toEqual(["学习"]);
  expect(await app.organizeItems([item], "tag", ["学习", "阅读"])).toBe(1);
  expect((await db.items.get(item.id))?.tags).toEqual(["学习", "阅读"]);
});
it("bulk completion skips non-tasks and already-completed records", async () => {
  const { app, db, item } = await setup(); const note = await app.createItem({ title: "笔记", kind: "note" });
  expect(await app.organizeItems([item, note], "complete")).toBe(1);
  expect((await db.items.get(note.id))?.status).toBe("open"); expect(await db.items.count()).toBe(3);
});
it("bulk deletion is reversible through recently deleted", async () => {
  const { app, db, item } = await setup(); await app.organizeItems([item], "delete");
  expect((await db.items.get(item.id))?.deletedAt).toBeTruthy();
  await app.restoreItem(item.id); expect((await db.items.get(item.id))?.repeat).toEqual(item.repeat);
});
it("round trips v4 metadata and restores it after an older v3 import", async () => {
  const { app, item } = await setup(); await app.updateItem(item.id, { status: "completed" });
  const all = await app.allRecords(); const backup = createFullBackup(all.items, [], "sage", all);
  expect(backup.version).toBe(6); expect(parseBackup(JSON.stringify(backup))).toEqual(backup);
  const old = { ...backup, version: 3, items: [] };
  await app.importBackup(parseBackup(JSON.stringify(old))); expect((await app.allRecords()).items).toHaveLength(0);
  await app.restoreRecovery(); expect((await app.allRecords()).items.map(value => value.repeat)).toEqual(all.items.map(value => value.repeat));
});
it("rejects malformed metadata and cyclic or missing successor links before import", async () => {
  const { app, item } = await setup(); const all = await app.allRecords(); const backup = createFullBackup(all.items, [], "sage", all);
  for (const changes of [{ tags: 1 }, { pinned: "yes" }, { repeatNextId: "missing" }, { repeatNextId: item.id }, { repeat: null }]) {
    expect(() => parseBackup(JSON.stringify({ ...backup, items: [{ ...item, ...changes }] }))).toThrow();
  }
  expect(() => parseBackup(JSON.stringify({ ...backup, items: [{ ...item, repeatNextId: "b" }, { ...item, id: "b", repeatNextId: item.id }] }))).toThrow("循环");
});

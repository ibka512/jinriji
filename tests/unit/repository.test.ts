import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { JinrijiDatabase } from "../../src/data/database";
import { AppRepository } from "../../src/data/repositories";

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

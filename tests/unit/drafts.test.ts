import { describe, expect, it } from "vitest";
import { DRAFT_KEY, DraftStore, type Draft } from "../../src/data/drafts";

function setup() {
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
  return { store: new DraftStore(storage), map, storage };
}
const draft: Draft = { key: "new", id: "stable-id", type: "note", title: "", body: "未完成\n的记录", date: "", time: "", updatedAt: "2026-08-31T10:00:00Z" };

describe("draft safety", () => {
  it("restores drafts across instances and retains their create ID", () => {
    const { store, storage } = setup(); store.save(draft);
    expect(new DraftStore(storage).get("new")).toEqual(draft);
  });
  it("keeps independent editing drafts and removes only the selected one", () => {
    const { store } = setup(); store.save(draft); store.save({ ...draft, key: "item:2", body: "另一份" });
    store.remove("new"); expect(store.list()).toHaveLength(1); expect(store.get("item:2")?.body).toBe("另一份");
  });
  it("does not overwrite malformed existing drafts", () => {
    const { store, map } = setup(); map.set(DRAFT_KEY, '{"invalid":true}');
    expect(() => store.save(draft)).toThrow(); expect(map.get(DRAFT_KEY)).toBe('{"invalid":true}');
  });
  it("surfaces storage failure rather than reporting a saved draft", () => {
    const store = new DraftStore({ getItem: () => null, setItem: () => { throw new Error("quota"); } });
    expect(() => store.save(draft)).toThrow("quota");
  });
});

import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JinrijiDatabase } from "../../src/data/database";
import { WritingRepository, NOTE_HISTORY_LIMIT } from "../../src/data/writing-repository";
import { AppRepository } from "../../src/data/repositories";
import { IndexedDraftStore } from "../../src/data/indexed-drafts";
import { DRAFT_KEY } from "../../src/data/drafts";
import { characterCount, documentHTML, documentMarkdown, documentText, textDocument, validateDocument, type NoteDocument } from "../../src/domain/note-document";
import { createFullBackup, parseBackup } from "../../src/data/backup";

const databases: JinrijiDatabase[] = [];
const setup = () => { const db = new JinrijiDatabase(`writing-${crypto.randomUUID()}`); databases.push(db); return { db, writing: new WritingRepository(db), app: new AppRepository(db), drafts: new IndexedDraftStore(db) }; };
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(databases.splice(0).map(db => db.delete())); });
const rich: NoteDocument = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "日记" }] }, { type: "paragraph", content: [{ type: "text", text: "你好", marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.com" } }] }] }, { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "读书" }] }] }] }] };

describe("portable structured writing", () => {
  it("preserves old literal text including Markdown punctuation and empty lines", () => {
    const text = "# 不是标题\n**不是粗体**\n\n  保留缩进  \n";
    expect(documentText(textDocument(text))).toBe(text); validateDocument(textDocument(text));
    expect(documentHTML(textDocument(text))).not.toContain("<h1>");
  });
  it("renders safe semantic markup and basic Markdown", () => {
    validateDocument(rich); expect(documentText(rich)).toBe("日记\n你好\n读书");
    expect(documentHTML(rich)).toContain('<h2>日记</h2>'); expect(documentHTML(rich)).toContain('rel="noopener noreferrer"');
    expect(documentMarkdown(rich)).toContain("## 日记"); expect(documentMarkdown(rich)).toContain("- [x] 读书");
    expect(characterCount("你好 a b\n🙂")).toBe(5);
  });
  it("rejects malicious links, unsupported nodes, corrupt schema and excessive nesting", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "https://good.com\njavascript:x"]) {
      expect(() => validateDocument({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "link", marks: [{ type: "link", attrs: { href } }] }] }] })).toThrow();
    }
    expect(() => validateDocument({ type: "doc", content: [{ type: "image" }] })).toThrow();
    expect(() => validateDocument({ type: "doc", content: [{ type: "text", text: "bad root" }] })).toThrow();
    let nested: NoteDocument = { type: "paragraph" }; for (let i = 0; i < 34; i++) nested = { type: "blockquote", content: [nested] };
    expect(() => validateDocument({ type: "doc", content: [nested] })).toThrow();
    expect(documentHTML(textDocument('<script>alert("x")</script>'))).not.toContain("<script>");
  });
  it("accepts 200k characters, rejects overflow and preserves a trailing newline", () => {
    validateDocument(textDocument("字".repeat(200_000)));
    expect(() => validateDocument(textDocument("字".repeat(200_001)))).toThrow();
    expect(documentText(textDocument("字\n"))).toBe("字\n");
  });
  it("exports v6 and accepts all older full backup formats", async () => {
    const { writing, app } = setup(); await writing.save({ kind: "note", title: "标题", document: rich }, "a");
    const all = await app.allRecords(); const backup = createFullBackup(all.items, all.courses, "sage", all);
    expect(backup.version).toBe(6); expect(parseBackup(JSON.stringify(backup))).toEqual(backup);
    for (const version of [2, 3, 4]) expect(parseBackup(JSON.stringify({ ...backup, version, items: [{ ...all.items[0], document: undefined }] })).items[0]?.body).toBe("日记\n你好\n读书");
    expect(() => parseBackup(JSON.stringify({ ...backup, items: [{ ...all.items[0], body: "stale" }] }))).toThrow("不一致");
    await app.importBackup(parseBackup(JSON.stringify({ ...backup, items: [] })));
    await app.restoreRecovery(); expect((await app.listItems())[0]?.document).toEqual(rich);
  });
});

describe("writing persistence safety", () => {
  it("upgrades a real v1 database without rewriting its existing note", async () => {
    const name = `upgrade-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({ items: "&id, kind, status, createdAt, updatedAt, dueAt, startAt, courseId, deletedAt", courses: "&id, name, termId, updatedAt, deletedAt", terms: "&id, startDate, endDate, isActive", recurrenceRules: "&id, courseId, weekday, startWeek, endWeek", occurrenceExceptions: "&id, ruleId, originalDate, kind", settings: "&key, updatedAt", migrations: "&id, completedAt" });
    const item = { id: "old", kind: "note", title: "旧记录", body: "**原文**", revision: 1, status: "open", allDay: false, reminderOffsets: [], createdAt: "2026-08-30T12:00:00Z", updatedAt: "2026-08-30T12:00:00Z" };
    await old.table("items").add(item); old.close();
    const upgraded = new JinrijiDatabase(name); databases.push(upgraded);
    expect(await upgraded.items.get("old")).toEqual(item);
    expect(await upgraded.drafts.count()).toBe(0); expect(await upgraded.noteVersions.count()).toBe(0);
  });
  it("orders equal-timestamp versions by their original revision", async () => {
    const { db, writing } = setup(); const item = await writing.save({ kind: "note", title: "一", body: "一" }, "a");
    await db.noteVersions.bulkAdd([{ id: "z", itemId: "a", savedAt: item.updatedAt, item }, { id: "a", itemId: "a", savedAt: item.updatedAt, item: { ...item, revision: 2, body: "二" } }]);
    expect((await writing.history("a"))[0]?.item.body).toBe("二");
  });
  it("uses revision checks and never silently overwrites another window", async () => {
    const { writing, db } = setup(); const item = await writing.save({ kind: "note", title: "一", document: rich }, "a");
    await writing.save({ kind: "note", title: "二", document: textDocument("窗口二") }, item.id, item.revision);
    await expect(writing.save({ kind: "note", title: "一", document: rich }, item.id, item.revision)).rejects.toThrow("另一窗口");
    expect((await db.items.get("a"))?.body).toBe("窗口二");
    await expect(writing.save({ kind: "note", title: "重复新建" }, "a")).rejects.toThrow();
  });
  it("bounds history and keeps the previous text before each explicit checkpoint", async () => {
    const { writing } = setup(); let item = await writing.save({ kind: "note", title: "0", body: "0" }, "a");
    for (let n = 1; n <= 25; n++) item = await writing.save({ kind: "note", title: String(n), body: String(n) }, "a", item.revision, true);
    const history = await writing.history("a"); expect(history).toHaveLength(NOTE_HISTORY_LIMIT); expect(history.some(v => v.item.body === "24")).toBe(true);
  });
  it("rolls the item write back if its history cannot be committed", async () => {
    const { writing, db } = setup(); const item = await writing.save({ kind: "note", title: "原文", document: rich }, "a");
    vi.spyOn(db.noteVersions, "add").mockRejectedValueOnce(new Error("quota"));
    await expect(writing.save({ kind: "note", title: "修改", document: textDocument("新文") }, "a", item.revision, true)).rejects.toThrow("quota");
    expect(await db.items.get("a")).toEqual(item);
  });
  it("preserves legacy converted content and refuses silent plain-text flattening", async () => {
    const { writing, app } = setup(); const item = await writing.save({ kind: "note", title: "原文", document: rich }, "a");
    const task = await app.updateItem(item.id, { kind: "task" }); expect(task?.document).toEqual(rich);
    await expect(app.updateItem(item.id, { body: "已改正文" })).rejects.toThrow("原文未改变");
    expect((await app.listItems())[0]?.document).toEqual(rich);
    const updatedDoc = structuredClone(rich); updatedDoc.content!.push({ type: "paragraph", content: [{ type: "text", text: "追加内容" }] });
    const changed = await app.updateItem(item.id, { document: updatedDoc }); expect(documentText(changed!.document!)).toContain("追加内容");
  });
  it("creates an independently editable linked task and leaves the note unchanged", async () => {
    const { writing, app } = setup(); const note = await writing.save({ kind: "note", title: "来源", document: rich }, "source");
    const task = await app.createLinkedTask(note.id, note.revision);
    await app.updateItem(task.id, { body: "执行步骤" }, task.revision);
    expect((await app.listItems()).find(item => item.id === note.id)).toEqual(note);
    expect(task).toMatchObject({ sourceNoteId: note.id, kind: "task", document: undefined });
    await expect(app.createLinkedTask(note.id, 0)).rejects.toThrow("已变动");
  });
  it("migrates drafts once without changing or deleting the legacy source", async () => {
    const { db, drafts } = setup();
    const original = JSON.stringify([{ key: "new", id: "legacy", type: "note", title: "旧草稿", body: "**原文**", date: "", time: "", updatedAt: new Date().toISOString() }]);
    const storage = { getItem: (key: string) => key === DRAFT_KEY ? original : null, setItem: vi.fn() };
    await drafts.migrate(storage); expect((await drafts.list())[0]?.body).toBe("**原文**");
    await drafts.remove("new"); await drafts.migrate(storage); expect(await db.drafts.count()).toBe(0); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it("does not mark a malformed or failed migration complete", async () => {
    const { db, drafts } = setup(); await expect(drafts.migrate({ getItem: () => "{}", setItem: () => {} })).rejects.toThrow();
    expect(await db.settings.get("drafts:indexed:v0.8")).toBeUndefined();
  });
});

import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { JinrijiDatabase } from "../../src/data/database";
import { LibraryRepository } from "../../src/data/library-repository";
import { AppRepository } from "../../src/data/repositories";
import { WritingRepository } from "../../src/data/writing-repository";
import { createFullBackup, parseBackup } from "../../src/data/backup";
import { documentHTML, documentMarkdown, documentText, textDocument, validateDocument, type NoteDocument } from "../../src/domain/note-document";
import { documentReferences, noteTemplates, templateDocument, validateAsset } from "../../src/domain/notebooks";
import { parseRoute, routeHash } from "../../src/ui/navigation";
const databases: JinrijiDatabase[] = [];
const setup = () => { const db = new JinrijiDatabase(`library-${crypto.randomUUID()}`); databases.push(db); return { db, library: new LibraryRepository(db), app: new AppRepository(db), writing: new WritingRepository(db) }; };
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(databases.splice(0).map(db => db.delete())); });
const asset = { id: "image-1", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC2kAAAAASUVORK5CYII=", width: 1, height: 1, createdAt: "2026-08-31T00:00:00Z" };
const imageDoc: NoteDocument = { type: "doc", content: [{ type: "localImage", attrs: { assetId: asset.id, alt: "安全图片" } }, { type: "paragraph" }] };
it("creates, renames, detects duplicate and stale notebooks", async () => {
  const { library } = setup(); const book = await library.saveNotebook(" 学习 "); expect(book.name).toBe("学习");
  await expect(library.saveNotebook("学习")).rejects.toThrow("同名");
  await expect(library.saveNotebook(" ")).rejects.toThrow();
  expect((await library.saveNotebook("课堂", book)).revision).toBe(2);
  await expect(library.saveNotebook("旧改动", book)).rejects.toThrow("变动");
});
it("deleting a notebook moves notes intact to unfiled and protects open editors", async () => {
  const { library, writing, db } = setup(); const book = await library.saveNotebook("学习");
  const note = await writing.save({ kind: "note", title: "原文", document: textDocument("内容"), notebookId: book.id }, "n");
  await library.deleteNotebook(book); const result = await db.items.get("n");
  expect(result?.notebookId).toBeUndefined(); expect(result?.body).toBe("内容"); expect(result?.revision).toBe(2); expect(result?.deletedAt).toBeUndefined();
  await expect(writing.save({ ...note }, note.id, note.revision)).rejects.toThrow();
});
it("rolls notebook deletion back when moving items fails", async () => {
  const { library, writing, db } = setup(); const book = await library.saveNotebook("学习");
  await writing.save({ kind: "note", title: "一", notebookId: book.id }, "n");
  db.items.hook("updating", () => { throw new Error("quota"); });
  await expect(library.deleteNotebook(book)).rejects.toThrow(); expect((await db.notebooks.get(book.id))?.deletedAt).toBeUndefined();
});
it("templates are independent valid documents", () => {
  for (const template of noteTemplates) validateDocument(templateDocument(template.id).document);
  const first = templateDocument("lecture"); first.document.content = [];
  expect(documentText(templateDocument("lecture").document)).toContain("要点");
});
it("renders note links safely and derives backlink references", () => {
  const doc = textDocument("链接"); doc.content![0]!.content![0]!.marks = [{ type: "noteLink", attrs: { noteId: 'a"<test>' } }];
  validateDocument(doc); expect(documentReferences(doc).notes.has('a"<test>')).toBe(true);
  expect(documentHTML(doc)).toContain("a%22%3Ctest%3E"); expect(documentHTML(doc)).not.toContain('<test>');
  expect(documentMarkdown(doc)).toContain("#notes/item/");
});
it("rejects missing assets before committing a note", async () => {
  const { writing, db } = setup();
  await expect(writing.save({ kind: "note", title: "图片", document: imageDoc }, "n")).rejects.toThrow("图片缺失");
  expect(await db.items.count()).toBe(0);
});
it("v6 round trips assets/notebooks; older import and restore retain draft assets", async () => {
  const { library, writing, app, db } = setup(); const book = await library.saveNotebook("图片"); await library.addAsset(asset);
  await writing.save({ kind: "note", title: "图", document: imageDoc, notebookId: book.id }, "n");
  const records = await app.allRecords(); const backup = createFullBackup(records.items, records.courses, "sage", records);
  expect(parseBackup(JSON.stringify(backup))).toEqual(backup);
  await app.importBackup(parseBackup(JSON.stringify({ ...backup, version: 5, items: [] })));
  expect(await db.notebooks.count()).toBe(0); expect(await db.assets.get(asset.id)).toEqual(asset);
  await app.restoreRecovery(); expect((await db.items.get("n"))?.notebookId).toBe(book.id); expect(await db.notebooks.count()).toBe(1);
});
it("rejects incomplete backups and asset collisions atomically", async () => {
  const { library, writing, app, db } = setup(); await library.addAsset(asset);
  await writing.save({ kind: "note", title: "图", document: imageDoc }, "n");
  const records = await app.allRecords(); const backup = createFullBackup(records.items, records.courses, "sage", records);
  expect(() => parseBackup(JSON.stringify({ ...backup, assets: [] }))).toThrow("缺少");
  expect(() => parseBackup(JSON.stringify({ ...backup, version: 2 }))).toThrow("v6");
  const different = { ...asset, dataUrl: asset.dataUrl.replace("AAwMCAO", "AAwMCAP") };
  await expect(app.importBackup({ ...backup, assets: [different] })).rejects.toThrow("冲突");
  expect((await db.items.get("n"))?.title).toBe("图"); expect(await db.assets.get(asset.id)).toEqual(asset);
});
it("rejects remote, SVG, mislabelled, oversized and excessive-dimension images", () => {
  validateAsset(asset);
  for (const changes of [{ dataUrl: "https://example.com/p.png" }, { dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }, { dataUrl: "data:image/png;base64,PHN2Zz4=" }, { width: 1601 }, { dataUrl: "data:image/png;base64," + "A".repeat(700_000) }]) expect(() => validateAsset({ ...asset, ...changes })).toThrow();
});
it("validates bounded simple tables and exports Markdown", () => {
  const table: NoteDocument = { type: "doc", content: [{ type: "table", content: Array.from({ length: 3 }, () => ({ type: "tableRow", content: Array.from({ length: 2 }, () => ({ type: "tableCell", content: [{ type: "paragraph" }] })) })) }] };
  validateDocument(table); expect(documentHTML(table)).toContain("<table>"); expect(documentMarkdown(table)).toContain("| --- | --- |");
  table.content![0]!.content![0]!.content!.pop(); expect(() => validateDocument(table)).toThrow("表格");
  table.content![0]!.content = Array.from({ length: 21 }, () => ({ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] })); expect(() => validateDocument(table)).toThrow();
});
it("preserves origin links on selected-text tasks without mutating the note", async () => {
  const { app } = setup(); const note = await app.createItem({ kind: "note", title: "笔记", body: "要复习" });
  const task = await app.createItem({ kind: "task", title: "要复习", sourceNoteId: note.id });
  expect(task.sourceNoteId).toBe(note.id); expect((await app.listItems()).find(item => item.id === note.id)).toEqual(note);
});
it("round trips reading/editing/new note routes and preserves old links", () => {
  for (const hash of ["#notes/item/a", "#notes/item/a/edit", "#notes/new/a", "#notes/course/a", "#plan/courses"]) expect(routeHash(parseRoute(hash))).toBe(hash);
});

import type { JinrijiDatabase } from "./database";
import type { Item } from "../domain/models";
import { documentText, validateDocument } from "../domain/note-document";
import { documentReferences } from "../domain/notebooks";
import { AppRepository, type CreateItemInput } from "./repositories";

export interface NoteVersion { id: string; itemId: string; savedAt: string; item: Item }
export const NOTE_HISTORY_LIMIT = 20;
const HISTORY_TOTAL_LIMIT = 100;
const oldestFirst = (a: NoteVersion, b: NoteVersion): number => a.savedAt.localeCompare(b.savedAt) || a.item.revision - b.item.revision;

export class WritingRepository {
  constructor(private readonly database: JinrijiDatabase) {}
  async save(input: CreateItemInput, id: string, revision?: number, checkpoint = false): Promise<Item> {
    if (input.document) { validateDocument(input.document); input = { ...input, body: documentText(input.document) }; }
    return this.database.transaction("rw", [this.database.items, this.database.noteVersions, this.database.notebooks, this.database.assets], async () => {
      if (input.notebookId) {
        const book = await this.database.notebooks.get(input.notebookId);
        if (!book || book.deletedAt) throw new Error("笔记本已移除，请在笔记信息中重新选择");
      }
      for (const assetId of documentReferences(input.document).assets) if (!await this.database.assets.get(assetId)) throw new Error("本地图片缺失，内容尚未保存");
      const previous = await this.database.items.get(id);
      if (revision === undefined && previous) throw new Error("此记录已在另一处保存，请另存副本");
      if (revision !== undefined && (!previous || previous.revision !== revision || previous.deletedAt)) throw new Error("另一窗口已修改这篇记录。你的内容仍保留，请另存副本或重新打开。");
      const repository = new AppRepository(this.database);
      const item = previous ? await repository.updateItem(id, input, revision) : await repository.createItem(input, id);
      if (!item) throw new Error("记录已移除，输入仍保留");
      if (previous && (previous.body !== item.body || previous.title !== item.title || JSON.stringify(previous.document) !== JSON.stringify(item.document))) {
        const versions = await this.database.noteVersions.where("itemId").equals(id).sortBy("savedAt");
        versions.sort(oldestFirst);
        const last = versions.at(-1);
        if (checkpoint || !last || Date.now() - Date.parse(last.savedAt) >= 60_000) {
          await this.database.noteVersions.add({ id: crypto.randomUUID(), itemId: id, savedAt: new Date().toISOString(), item: previous });
          if (versions.length >= NOTE_HISTORY_LIMIT) await this.database.noteVersions.bulkDelete(versions.slice(0, versions.length - NOTE_HISTORY_LIMIT + 1).map(v => v.id));
          const total = await this.database.noteVersions.count();
          if (total > HISTORY_TOTAL_LIMIT) await this.database.noteVersions.bulkDelete(await this.database.noteVersions.orderBy("savedAt").limit(total - HISTORY_TOTAL_LIMIT).primaryKeys());
        }
      }
      return item;
    });
  }
  async history(id: string): Promise<NoteVersion[]> { return (await this.database.noteVersions.where("itemId").equals(id).toArray()).sort(oldestFirst).reverse(); }
  async position(id: string): Promise<{ cursor?: number; scroll?: number }> { return (await this.database.settings.get(`writer-position:${id}`))?.value as { cursor?: number; scroll?: number } || {}; }
  async remember(id: string, cursor: number, scroll: number): Promise<void> { await this.database.settings.put({ key: `writer-position:${id}`, value: { cursor, scroll }, updatedAt: new Date().toISOString() }); }
}

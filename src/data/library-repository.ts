import type { JinrijiDatabase } from "./database";
import { nameNotebook, validateAsset, type Notebook, type NoteAsset } from "../domain/notebooks";

export class LibraryRepository {
  constructor(private readonly database: JinrijiDatabase) {}
  async saveNotebook(name: string, original?: Notebook): Promise<Notebook> {
    name = nameNotebook(name);
    return this.database.transaction("rw", this.database.notebooks, async () => {
      const all = await this.database.notebooks.toArray();
      const current = original && all.find(book => book.id === original.id);
      if (original && (!current || current.deletedAt || current.revision !== original.revision)) throw new Error("笔记本已变动，请重新打开");
      if (all.some(book => !book.deletedAt && book.id !== original?.id && book.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("已有同名笔记本");
      const now = new Date().toISOString();
      const book = { id: original?.id || crypto.randomUUID(), name, createdAt: original?.createdAt || now, updatedAt: now, revision: (original?.revision || 0) + 1 };
      await this.database.notebooks.put(book); return book;
    });
  }
  async deleteNotebook(book: Notebook): Promise<void> {
    await this.database.transaction("rw", [this.database.items, this.database.notebooks], async () => {
      const current = await this.database.notebooks.get(book.id);
      if (!current || current.deletedAt || current.revision !== book.revision) throw new Error("笔记本已变动，请刷新后重试");
      const now = new Date().toISOString();
      await this.database.notebooks.put({ ...current, deletedAt: now, revision: current.revision + 1 });
      await this.database.items.filter(item => item.notebookId === book.id).modify(item => {
        delete item.notebookId; item.updatedAt = now; item.revision++;
      });
    });
  }
  async addAsset(asset: NoteAsset): Promise<void> { validateAsset(asset); await this.database.assets.add(asset); }
}

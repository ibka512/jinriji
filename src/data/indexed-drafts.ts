import type { JinrijiDatabase } from "./database";
import { DraftStore, type Draft } from "./drafts";
import { validateDocument } from "../domain/note-document";

/** Keep original localStorage bytes untouched as a migration fallback. */
export class IndexedDraftStore {
  constructor(private readonly database: JinrijiDatabase) {}
  async migrate(storage: Pick<Storage, "getItem" | "setItem">): Promise<void> {
    const key = "drafts:indexed:v0.8";
    if (await this.database.settings.get(key)) return;
    const drafts = new DraftStore(storage).list();
    await this.database.transaction("rw", this.database.drafts, this.database.settings, async () => {
      if (await this.database.settings.get(key)) return;
      for (const draft of drafts) if (!await this.database.drafts.get(draft.key)) await this.database.drafts.add(draft);
      await this.database.settings.put({ key, value: true, updatedAt: new Date().toISOString() });
    });
  }
  async list(): Promise<Draft[]> { return this.database.drafts.orderBy("updatedAt").reverse().toArray(); }
  async get(key: string): Promise<Draft | undefined> {
    return (await this.list()).find(draft => key === "new" ? !draft.entity : `${draft.entity}:${draft.id}` === key);
  }
  async save(draft: Draft): Promise<void> { if (draft.document) validateDocument(draft.document); await this.database.drafts.put(draft); }
  async remove(key: string): Promise<void> { await this.database.drafts.delete(key); }
}

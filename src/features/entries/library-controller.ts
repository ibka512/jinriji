import { LibraryRepository } from "../../data/library-repository";
import { noteTemplates, templateDocument, type Notebook } from "../../domain/notebooks";
import { documentText } from "../../domain/note-document";
import type { Draft } from "../../data/drafts";
import type { RenderOptions } from "./render";
import { query, safeHTML as escape } from "../../ui/dom";
import { confirmAction } from "../../ui/confirmation";
import { showToast } from "../../ui/toast";

export class LibraryController {
  private editing?: Notebook;
  private busy = false;
  constructor(private readonly repository: LibraryRepository, private readonly books: () => Notebook[],
    private readonly options: RenderOptions, private readonly refresh: () => Promise<void>, private readonly open: (draft: Draft) => void) {}
  initialize(): void {
    const browser = document.createElement("div"); browser.id = "record-browser";
    const list = query("#notes-list"); list.before(browser);
    for (const selector of [".page-header", ".records-toolbar", "#search-summary", ".organization-filters", ".library-bar", "#notebook-manager", "#bulk-toolbar"]) browser.append(query(selector, query("#view-notes")));
    browser.append(list);
    query("#manage-notebooks").addEventListener("click", () => {
      query<HTMLElement>("#notebook-manager").hidden = false; this.editing = undefined;
      query<HTMLInputElement>("#notebook-name").value = ""; query<HTMLElement>("#notebook-name").focus();
    });
    query("#notebook-cancel").addEventListener("click", () => { query<HTMLElement>("#notebook-manager").hidden = true; });
    query("#notebook-filter").addEventListener("change", () => {
      this.options.notebookId = query<HTMLSelectElement>("#notebook-filter").value;
      void this.refresh().catch(() => showToast("读取失败，请重试"));
    });
    query("#notebook-form").addEventListener("submit", event => {
      event.preventDefault(); void this.run(async () => {
        await this.repository.saveNotebook(query<HTMLInputElement>("#notebook-name").value, this.editing);
        this.editing = undefined; query<HTMLInputElement>("#notebook-name").value = "";
        await this.refresh(); showToast("笔记本已保存");
      });
    });
    query("#notebook-rows").addEventListener("click", event => {
      const button = (event.target as Element).closest<HTMLElement>("button"); if (!button) return;
      const book = this.books().find(b => b.id === (button.dataset.renameBook || button.dataset.deleteBook)); if (!book) return;
      if (button.dataset.renameBook) { this.editing = book; query<HTMLInputElement>("#notebook-name").value = book.name; query<HTMLElement>("#notebook-name").focus(); }
      else void this.run(async () => {
        if (await confirmAction("删除笔记本？", "里面的笔记会移到未分类，正文不会删除。", "删除笔记本", () => this.repository.deleteNotebook(book))) {
          if (this.options.notebookId === book.id) this.options.notebookId = "unfiled";
          await this.refresh(); showToast("笔记本已删除，笔记保留在未分类");
        }
      });
    });
    query<HTMLSelectElement>("#new-note-template").innerHTML = '<option value="">选择模板</option>' + noteTemplates.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
    query("#new-note-template").addEventListener("change", () => {
      const select = query<HTMLSelectElement>("#new-note-template"); if (!select.value) return;
      const template = templateDocument(select.value); select.value = "";
      this.open({ key: "new", id: crypto.randomUUID(), type: "note", ...template, body: documentText(template.document),
        notebookId: this.options.notebookId === "unfiled" ? undefined : this.options.notebookId || undefined,
        date: "", time: "", updatedAt: new Date().toISOString() });
    });
    this.render();
  }
  render(): void {
    const books = this.books().filter(b => !b.deletedAt).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    query<HTMLSelectElement>("#notebook-filter").innerHTML = '<option value="">全部笔记本</option><option value="unfiled">未分类</option>' + books.map(book => `<option value="${escape(book.id)}">${escape(book.name)}</option>`).join("");
    query<HTMLSelectElement>("#notebook-filter").value = this.options.notebookId || "";
    query("#notebook-rows").innerHTML = books.length ? books.map(book => `<div class="notebook-row"><span>${escape(book.name)}</span><button class="text-button" data-rename-book="${escape(book.id)}">重命名</button><button class="text-button danger-text" data-delete-book="${escape(book.id)}">删除</button></div>`).join("") : '<p class="record-meta">还没有笔记本</p>';
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return; this.busy = true; query<HTMLElement>("#notebook-error").hidden = true;
    try { await action(); }
    catch (cause) { const error = query<HTMLElement>("#notebook-error"); error.textContent = cause instanceof Error ? cause.message : "保存失败，请重试"; error.hidden = false; }
    finally { this.busy = false; }
  }
}

import { AppRepository, type BulkAction } from "../../data/repositories";
import type { Item } from "../../domain/models";
import { filterRecords, normalizeTags, type RecordSort } from "../../domain/organization";
import { query } from "../../ui/dom";
import { confirmAction } from "../../ui/confirmation";
import { showToast } from "../../ui/toast";
import { renderNotes, type RenderOptions } from "./render";

export class OrganizationController {
  private busy = false;
  constructor(private readonly repository: AppRepository, private readonly items: () => Item[], private readonly options: RenderOptions,
    private readonly refresh: () => Promise<void>, private readonly savePreferences: () => void) { options.selected = new Map(); }

  resetSelection(): void { this.options.selected?.clear(); this.options.selecting = false; this.options.visibleLimit = 80; query<HTMLElement>("#bulk-tags-field").hidden = true; const books = document.getElementById("bulk-notebook-field"); if (books) books.hidden = true; }
  private render(): void { renderNotes(this.items(), this.options); }

  initialize(): void {
    query("#bulk-tags-field").insertAdjacentHTML("afterend", '<label class="study-field" id="bulk-notebook-field" hidden><span>移到笔记本，再点「移动笔记」确认</span><select id="bulk-notebook"><option value="">未分类</option></select></label>');
    query(".bulk-actions").insertAdjacentHTML("afterbegin", '<button class="text-button" data-bulk-action="notebook">移动笔记</button>');
    query("#record-sort").addEventListener("change", event => {
      this.resetSelection(); this.options.sort = (event.target as HTMLSelectElement).value as RecordSort; this.render(); this.savePreferences();
    });
    query("#record-tag-filter").addEventListener("change", event => {
      this.resetSelection(); this.options.tag = (event.target as HTMLSelectElement).value; this.render(); this.savePreferences();
    });
    document.addEventListener("click", event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
      if (!button || button.disabled || this.busy) return;
      void this.handle(button).catch(cause => showToast(cause instanceof Error ? cause.message : "整理失败，请重试"));
    });
  }

  private async handle(button: HTMLButtonElement): Promise<void> {
    const data = button.dataset;
    if (button.id === "load-more-records") { this.options.visibleLimit = (this.options.visibleLimit || 80) + 80; this.render(); return; }
    if (button.id === "clear-record-filters" || button.hasAttribute("data-clear-filters")) {
      this.resetSelection(); this.options.search = ""; this.options.filter = "all"; this.options.tag = ""; this.options.pinnedOnly = false; this.options.notebookId = "";
      query<HTMLInputElement>("#search-records").value = ""; query<HTMLSelectElement>("#record-filter").value = "all"; query<HTMLSelectElement>("#notebook-filter").value = "";
      query<HTMLDetailsElement>("#record-filters").open = false; this.render(); this.savePreferences(); query<HTMLElement>("#search-records").focus(); return;
    }
    if (button.id === "pinned-only") {
      this.resetSelection(); this.options.pinnedOnly = !this.options.pinnedOnly; this.render(); this.savePreferences();
    }
    if (button.id === "organize-toggle") {
      if (this.options.selecting) this.resetSelection(); else this.options.selecting = true;
      this.render();
    }
    if (data.recordSelect) {
      const selected = this.options.selected!; const item = this.items().find(item => item.id === data.recordSelect);
      if (!item) return;
      if (selected.has(item.id)) selected.delete(item.id); else selected.set(item.id, item.revision);
      this.render();
      [...document.querySelectorAll<HTMLButtonElement>("[data-record-select]")].find(value => value.dataset.recordSelect === item.id)?.focus({ preventScroll: true });
    }
    if (button.id === "select-visible") {
      const visible = filterRecords(this.items(), this.options.search, this.options.filter, this.options.tag, this.options.pinnedOnly, this.options.notebookId, this.options.sort);
      if (this.options.selected?.size === visible.length) this.options.selected.clear();
      else this.options.selected = new Map(visible.map(item => [item.id, item.revision]));
      this.render();
    }
    if (data.recordPin) {
      const item = this.items().find(value => value.id === data.recordPin && !value.deletedAt);
      if (!item) return;
      this.busy = true;
      try {
        await this.repository.updateItem(item.id, { pinned: !item.pinned }, item.revision); await this.refresh();
        const restored = [...document.querySelectorAll<HTMLButtonElement>("[data-record-pin]")].find(value => value.dataset.recordPin === item.id && value.getClientRects().length);
        restored?.focus({ preventScroll: true });
        showToast(item.pinned ? "已取消置顶" : "已置顶");
      } finally { this.busy = false; }
    }
    if (data.bulkAction) await this.applyBulk(data.bulkAction as BulkAction);
  }

  private async applyBulk(action: BulkAction): Promise<void> {
    const books = query<HTMLElement>("#bulk-notebook-field");
    if (action === "notebook" && books.hidden) {
      const select = query<HTMLSelectElement>("#bulk-notebook");
      select.replaceChildren(...Array.from(query<HTMLSelectElement>("#notebook-filter").options).filter(option => option.value !== "unfiled").map(option => option.cloneNode(true)));
      select.options[0]!.textContent = "未分类"; books.hidden = false; select.focus(); return;
    }
    const field = query<HTMLElement>("#bulk-tags-field");
    if (action === "tag" && field.hidden) { field.hidden = false; query<HTMLInputElement>("#bulk-tags").focus(); return; }
    const tags = action === "tag" ? normalizeTags(query<HTMLInputElement>("#bulk-tags").value) : [];
    if (action === "tag" && !tags.length) throw new Error("请输入标签，再点添加标签");
    const selection = [...(this.options.selected || new Map<string, number>())].map(([id, revision]) => ({ id, revision }));
    if (!selection.length) return;
    this.busy = true;
    const toolbar = query<HTMLElement>("#bulk-toolbar");
    toolbar.setAttribute("aria-busy", "true");
    const controls = [...toolbar.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select")];
    controls.forEach(control => control.disabled = true);
    let count = 0;
    const save = async (): Promise<void> => { count = await this.repository.organizeItems(selection, action, tags, query<HTMLSelectElement>("#bulk-notebook").value); };
    try {
      const confirmed = action === "delete" ? await confirmAction(`删除 ${selection.length} 条记录？`, "所选记录将移至最近删除，可在设置中恢复。", "删除", save) : (await save(), true);
      if (!confirmed) return;
      this.resetSelection(); query<HTMLInputElement>("#bulk-tags").value = "";
      await this.refresh(); query<HTMLElement>("#organize-toggle").focus();
      showToast(action === "delete" ? `已移至最近删除 · ${count} 项` : `已整理 ${count} 项`);
    } finally {
      this.busy = false; toolbar.removeAttribute("aria-busy");
      controls.forEach(control => control.disabled = false); this.render();
    }
  }
}

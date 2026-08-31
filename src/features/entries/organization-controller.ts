import { AppRepository, type BulkAction } from "../../data/repositories";
import type { Item } from "../../domain/models";
import { filterRecords, normalizeTags } from "../../domain/organization";
import { query } from "../../ui/dom";
import { confirmAction } from "../../ui/confirmation";
import { showToast } from "../../ui/toast";
import { renderNotes, type RenderOptions } from "./render";

export class OrganizationController {
  private busy = false;
  constructor(private readonly repository: AppRepository, private readonly items: () => Item[], private readonly options: RenderOptions,
    private readonly refresh: () => Promise<void>, private readonly savePreferences: () => void) { options.selected = new Map(); }

  resetSelection(): void { this.options.selected?.clear(); this.options.selecting = false; query<HTMLElement>("#bulk-tags-field").hidden = true; }
  private render(): void { renderNotes(this.items(), this.options); }

  initialize(): void {
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
      const visible = filterRecords(this.items(), this.options.search, this.options.filter, this.options.tag, this.options.pinnedOnly);
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
    const field = query<HTMLElement>("#bulk-tags-field");
    if (action === "tag" && field.hidden) { field.hidden = false; query<HTMLInputElement>("#bulk-tags").focus(); return; }
    const tags = action === "tag" ? normalizeTags(query<HTMLInputElement>("#bulk-tags").value) : [];
    if (action === "tag" && !tags.length) throw new Error("请输入标签，再点添加标签");
    const selection = [...(this.options.selected || new Map<string, number>())].map(([id, revision]) => ({ id, revision }));
    if (!selection.length) return;
    this.busy = true;
    const toolbar = query<HTMLElement>("#bulk-toolbar");
    toolbar.setAttribute("aria-busy", "true");
    const controls = [...toolbar.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button,input")];
    controls.forEach(control => control.disabled = true);
    let count = 0;
    const save = async (): Promise<void> => { count = await this.repository.organizeItems(selection, action, tags); };
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

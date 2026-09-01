import { type ComposeType, type Draft } from "../../data/drafts";
import { IndexedDraftStore } from "../../data/indexed-drafts";
import { WritingRepository } from "../../data/writing-repository";
import { textDocument } from "../../domain/note-document";
import { RichWriter } from "./rich-writer";
import { AppRepository } from "../../data/repositories";
import type { Course, Item } from "../../domain/models";
import { dateFields, itemTime, parseSchedule } from "../../domain/dates";
import { normalizeTags } from "../../domain/organization";
import { query, queryAll, safeHTML as escape } from "../../ui/dom";
import { confirmAction } from "../../ui/confirmation";
import { showToast } from "../../ui/toast";
import type { Selection } from "./render";
import type { Notebook } from "../../domain/notebooks";
import { LibraryRepository } from "../../data/library-repository";
import { cacheImages, prepareImage } from "./local-images";

const typeNames: Record<ComposeType, string> = { note: "便签", task: "待办", schedule: "日程", course: "课程" };

export class EntryEditor {
  private readonly dialog = query<HTMLDialogElement>("#compose-layer");
  private readonly page = query<HTMLElement>("#note-editor-page");
  private readonly notebook = query<HTMLSelectElement>("#entry-notebook");
  private notebooks: Notebook[] = [];
  onPageRequest?: (draft: Draft, recovered: boolean) => void;
  onPageDone?: (id?: string, scroll?: number) => void;
  onNoteCommitted?: (item: Item) => void;
  private readonly title = query<HTMLInputElement>("#entry-title");
  private readonly body = query<HTMLTextAreaElement>("#quick-entry");
  private readonly date = query<HTMLInputElement>("#entry-date");
  private readonly time = query<HTMLInputElement>("#entry-time");
  private current?: Draft;
  private baseline = "";
  private busy = false;
  private storageFailed = false;
  private courses: Course[] = [];
  private readonly courseField = query<HTMLSelectElement>("#entry-course");
  private readonly instructor = query<HTMLInputElement>("#entry-instructor");
  private readonly location = query<HTMLInputElement>("#entry-location");
  private readonly tags = query<HTMLInputElement>("#entry-tags");
  private readonly repeat = query<HTMLSelectElement>("#entry-repeat");
  private readonly writer: RichWriter;
  private timer?: number;
  private pending?: Promise<boolean>;
  private draftBaseline = "";
  private conflict = false;
  private sourceKey?: string;
  private checkpoint = true;

  constructor(private readonly repository: AppRepository, readonly drafts: IndexedDraftStore,
    private readonly onSaved: (selection: Selection) => Promise<void>, private readonly onDraftChange: () => void,
    private readonly writing: WritingRepository, library: LibraryRepository) {
    this.writer = new RichWriter(() => this.changed(), message => this.error(message), () => void this.showHistory(), () => this.title.value);
    this.writer.onImage = async file => {
      const asset = await prepareImage(file); await library.addAsset(asset); cacheImages([asset]); return asset.id;
    };
    this.writer.onBackup = async () => {
      if (this.current?.type !== "note" && this.contents() !== this.baseline) throw new Error("请先保存记录，再导出完整备份");
      if (this.pending) await this.pending;
      if (!await this.flush()) throw new Error("请先保存当前内容，再导出完整备份");
      query<HTMLButtonElement>("#export-data").click();
    };
    this.writer.onSelectionTask = async text => {
      if (this.pending) await this.pending;
      if (!await this.flush() || !this.current?.revision) throw new Error("请先保存笔记，再创建待办");
      const result = await this.repository.createItem({ kind: "task", title: text.split(/\r?\n/)[0]!.slice(0, 120), body: text, sourceNoteId: this.current.id, courseId: this.current.courseId });
      await this.onSaved({ entity: "item", id: result.id }); showToast("已加入待办，原文保留");
    };
  }

  get isOpen(): boolean { return this.dialog.open || this.isPage; }
  get isPage(): boolean { return !this.page.hidden; }
  private get rich(): boolean { return this.current?.type === "note" || Boolean(this.current?.document); }
  private get surface(): HTMLElement { return this.isPage ? this.page : this.dialog; }
  private get scroll(): number { return this.isPage ? window.scrollY : query<HTMLElement>(".editor-fields").scrollTop; }
  setCourses(courses: Course[]): void { this.courses = courses; }
  setNotebooks(notebooks: Notebook[]): void { this.notebooks = notebooks; }
  setNotes(items: Item[]): void { this.writer.notes = items; }

  initialize(): void {
    const updateViewport = (): void => {
      this.dialog.style.setProperty("--visual-height", `${window.visualViewport?.height ?? window.innerHeight}px`);
      this.dialog.style.setProperty("--visual-top", `${window.visualViewport?.offsetTop ?? 0}px`);
    };
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    updateViewport();
    const head = query<HTMLElement>(".compose-head");
    new ResizeObserver(() => {
      if (this.isPage) this.page.style.setProperty("--writer-header-height", `${head.getBoundingClientRect().height}px`);
    }).observe(head);
    query("#entry-form").addEventListener("submit", event => { event.preventDefault(); void this.save(); });
    queryAll("[data-close-compose]").forEach(button => button.addEventListener("click", () => this.close()));
    this.dialog.addEventListener("cancel", event => { event.preventDefault(); this.close(); });
    document.addEventListener("keydown", event => {
      if (!this.isOpen) return;
      if (event.key !== "Escape" || event.isComposing || this.writer.isComposing || query<HTMLDialogElement>("#confirm-dialog").open) return;
      event.preventDefault(); event.stopPropagation();
      const panel = this.surface.querySelector<HTMLElement>(".writer-link:not([hidden]),.writer-find:not([hidden]),.writer-insert:not([hidden])");
      const more = this.surface.querySelector<HTMLDetailsElement>(".writer-more[open]");
      if (panel) { panel.hidden = true; this.writer.focus(); }
      else if (more) { more.open = false; more.querySelector<HTMLElement>("summary")?.focus(); }
      else void this.close();
    }, true);
    for (const input of [this.title, this.body, this.date, this.time, this.courseField, this.instructor, this.location, this.tags, this.repeat, this.notebook]) input.addEventListener("input", () => this.changed());
    this.repeat.addEventListener("change", () => { query<HTMLElement>("#repeat-hint").hidden = !this.repeat.value; this.changed(); });
    queryAll<HTMLButtonElement>("[data-entry-type]").forEach(button => button.addEventListener("click", () => {
      if (!this.current || this.busy || this.pending) return;
      if (this.current.type === "note") { this.current.document = this.writer.document; this.current.body = this.writer.text; this.body.value = this.writer.text; }
      this.current.type = button.dataset.entryType as ComposeType;
      if (this.current.type === "note" && !this.isPage) {
        const draft = { ...this.snapshot(), type: "note" as const, body: this.body.value, document: this.current.document || textDocument(this.body.value) };
        this.finishClose(true); history.replaceState({ jinriji: true }, "", location.href);
        this.open(draft, true); return;
      }
      this.updateType(); this.changed();
    }));
    query("#save-as-new").addEventListener("click", () => void this.save(true));
    query("#discard-draft").addEventListener("click", () => {
      if (this.busy || this.pending || !this.current) return;
      void confirmAction("舍弃草稿？", "未保存的修改将被移除，已保存的记录不受影响。", "舍弃", async () => {
        await this.drafts.remove(this.current!.key);
        if (this.sourceKey) await this.drafts.remove(this.sourceKey);
      }).then(confirmed => { if (confirmed) this.finishClose(); });
    });
    document.addEventListener("keydown", event => {
      if (this.isOpen && (event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.isComposing && !query<HTMLDialogElement>("#confirm-dialog").open) {
        event.preventDefault(); void this.save();
      }
    });
    window.addEventListener("beforeunload", event => {
      if (this.busy || this.pending || this.writer.isWorking || (this.isOpen && this.contents() !== (this.current?.type === "note" ? this.baseline : this.draftBaseline))) {
        event.preventDefault(); event.returnValue = ""; if (!this.writer.isComposing) void this.flush();
      }
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.isOpen && !this.writer.isComposing) void this.flush(); });
  }

  async openNew(type: ComposeType, date = "", courseId?: string): Promise<void> {
    const draft = this.isOpen ? undefined : await this.drafts.get("new");
    this.open(draft ?? { key: "new", id: crypto.randomUUID(), type, title: "", body: "", date, time: "", courseId, updatedAt: new Date().toISOString() }, Boolean(draft));
  }

  async openRecord(record: Item | Course, fromRoute = false, readScroll?: number): Promise<void> {
    const item = "kind" in record ? record : undefined;
    const course = !item ? record as Course : undefined;
    const entity = item ? "item" : "course";
    const key = `${entity}:${record.id}`;
    const draft = await this.drafts.get(key);
    const position = item ? await this.writing.position(record.id).catch(() => ({})) : {};
    if (readScroll !== undefined) Object.assign(position, { scroll: readScroll });
    const fields = dateFields(item ? itemTime(item) : course!.firstMeetingAt, record.allDay, record.dateOnly);
    this.open(draft ?? { key, entity, id: record.id, revision: record.revision, type: item ? item.kind === "event" ? "schedule" : item.kind : "course",
      title: item ? item.title === item.body ? "" : item.title : course!.name, body: item?.body ?? "", document: item?.document, notebookId: item?.notebookId, ...position, courseId: item?.courseId, location: course?.location, instructor: course?.instructor,
      tagsText: item?.tags?.join("，"), repeatFrequency: item?.repeat?.frequency || "", repeat: item?.repeat, repeatSourceDate: fields.date,
      ...fields, updatedAt: new Date().toISOString() }, Boolean(draft), fromRoute);
  }

  open(draft: Draft, recovered = true, fromRoute = false): void {
    if (draft.type === "note" && !fromRoute && this.onPageRequest) { this.onPageRequest(draft, recovered); return; }
    if (document.querySelector("dialog[open]")) return;
    if (draft.type === "note") {
      this.page.append(...Array.from(this.dialog.childNodes)); this.page.hidden = false;
      document.body.classList.add("note-writing"); query("#view-notes").classList.add("has-detail");
      query(".records-workspace").classList.add("has-detail");
      query<HTMLElement>("#entry-detail").hidden = true;
      query("#entry-organization").append(this.courseField.closest("label")!);
      query(".compose-head").append(query(".editor-footer"));
      query("#save-entry").setAttribute("form", "entry-form");
      const back = query<HTMLElement>("[data-close-compose]", this.page);
      back.setAttribute("aria-label", "返回记录"); back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
    }
    this.sourceKey = recovered ? draft.key : undefined;
    this.current = { ...draft, key: `session:${crypto.randomUUID()}`, id: draft.id || crypto.randomUUID() };
    this.conflict = false; this.checkpoint = true;
    this.writer.mount(draft.document || textDocument(draft.body), draft.cursor);
    this.title.value = draft.title; this.body.value = draft.body; this.date.value = draft.date; this.time.value = draft.time;
    this.instructor.value = draft.instructor || ""; this.location.value = draft.location || "";
    this.tags.value = draft.tagsText || ""; this.repeat.value = draft.repeatFrequency || "";
    this.notebook.innerHTML = '<option value="">未分类</option>' + this.notebooks.filter(book => !book.deletedAt).map(book => `<option value="${escape(book.id)}">${escape(book.name)}</option>`).join("");
    this.notebook.value = draft.notebookId || "";
    query<HTMLDetailsElement>("#entry-organization").open = false;
    query<HTMLElement>("#repeat-hint").hidden = !this.repeat.value;
    const available = this.courses.filter(course => !course.deletedAt || course.id === draft.courseId);
    this.courseField.innerHTML = '<option value="">不关联</option>' + available.map(course => `<option value="${escape(course.id)}">${escape(course.name)}${course.deletedAt ? "（已删除）" : ""}</option>`).join("")
      + (draft.courseId && !available.some(course => course.id === draft.courseId) ? `<option value="${escape(draft.courseId)}">原课程不可用</option>` : "");
    this.courseField.value = draft.courseId || "";
    this.baseline = recovered || draft.revision === undefined && Boolean(draft.title || draft.body) ? "" : this.contents();
    this.draftBaseline = this.baseline;
    this.storageFailed = false;
    query<HTMLElement>("#entry-error").hidden = true;
    query<HTMLElement>("#save-as-new").hidden = true;
    query("#draft-status").textContent = recovered ? "已恢复草稿" : draft.revision !== undefined && draft.type === "note" ? "已保存到本机" : "";
    this.updateType();
    if (!this.isPage) {
      history.pushState({ ...history.state, jinrijiModal: "editor" }, "", location.href);
      this.dialog.showModal(); document.body.classList.add("editor-open");
      query<HTMLElement>(".editor-fields").scrollTop = draft.scroll || 0;
    } else window.scrollTo({ top: draft.scroll || 0, behavior: "instant" });
    if (this.rich) this.writer.focus(); else if (draft.type === "course") this.title.focus(); else {
      this.body.focus();
      this.body.setSelectionRange(0, 0);
      this.body.scrollTop = 0;
    }
    if (!this.baseline) this.changed();
  }

  private contents(): string {
    return JSON.stringify({ notebookId: this.notebook.value, type: this.current?.type, title: this.title.value, body: this.rich ? this.writer.text : this.body.value, document: this.rich ? this.writer.document : undefined, date: this.date.value, time: this.time.value, courseId: this.courseField.value, instructor: this.instructor.value, location: this.location.value, tagsText: this.tags.value, repeatFrequency: this.repeat.value });
  }

  private updateType(): void {
    if (!this.current) return;
    const course = this.current.type === "course";
    this.surface.dataset.entryKind = this.current.type;
    const editing = this.current.revision !== undefined;
    query("#compose-title").textContent = `${editing ? "编辑" : "新建"}${typeNames[this.current.type]}`;
    query("#entry-title-label").textContent = course ? "课程名称" : "标题（选填）";
    this.title.placeholder = course ? "课程名称" : "取一个标题";
    const note = this.current.type === "note";
    if (note && this.writer.text !== this.body.value) this.writer.setDocument(this.current.document && this.current.body === this.body.value ? this.current.document : textDocument(this.body.value));
    this.body.hidden = course || this.rich;
    this.writer.root.hidden = !this.rich;
    query<HTMLElement>('[data-write="selection-task"]').hidden = !note;
    query<HTMLElement>('[data-write="history"]').hidden = !note;
    query<HTMLElement>("#entry-body-label").hidden = course || this.rich;
    this.date.required = this.current.type === "schedule";
    this.date.setAttribute("aria-required", String(this.date.required));
    query("#save-entry").textContent = note ? "完成" : "保存记录";
    query<HTMLElement>("#discard-draft").hidden = note;
    query<HTMLElement>("#entry-details").hidden = this.current.type === "note" || (course && Boolean(this.courses.find(value => value.id === this.current?.id)?.termId));
    query<HTMLElement>("#course-metadata").hidden = !course;
    query<HTMLElement>("#entry-organization").hidden = course;
    query<HTMLElement>("#entry-notebook-field").hidden = !note;
    query("#entry-organization summary").textContent = note ? "笔记信息" : "标签";
    query<HTMLElement>("#entry-repeat-field").hidden = this.current.type !== "task";
    query<HTMLElement>("#entry-course-field").hidden = course || (!this.courses.length && !this.current.courseId);
    queryAll<HTMLButtonElement>("[data-entry-type]").forEach(button => {
      const active = button.dataset.entryType === this.current!.type;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.hidden = editing && button.dataset.entryType !== this.current!.type;
    });
  }

  async persist(): Promise<boolean> {
    if (!this.current || !this.isOpen) return true;
    const dirty = this.contents() !== this.baseline;
    try {
      if (dirty) {
        const contents = this.contents();
        this.current = this.snapshot();
        await this.drafts.save(this.current);
        if (this.sourceKey) { await this.drafts.remove(this.sourceKey); this.sourceKey = undefined; }
        this.draftBaseline = contents;
        if (this.current.type !== "note") query("#draft-status").textContent = "草稿已暂存";
      }
      this.storageFailed = false;
      return true;
    } catch {
      this.storageFailed = true;
      this.error("草稿暂存失败，请先保存记录，或复制内容后再离开。");
      return false;
    }
  }

  async close(_fromHistory = false): Promise<void> {
    if (!this.isOpen || this.busy) return;
    if (this.current?.type === "note") { await this.saveNote(true); return; }
    if (!await this.flush()) return;
    this.finishClose(_fromHistory);
  }

  async leavePage(): Promise<boolean> {
    if (!this.isPage) return true;
    if (this.busy || this.writer.isComposing || this.writer.isWorking) { showToast("请完成当前输入后再切换"); return false; }
    await this.saveNote(false);
    if (this.storageFailed || this.current && this.contents() !== this.baseline && (this.title.value.trim() || this.writer.text.trim())) return false;
    this.finishClose(true); return true;
  }

  private finishClose(fromHistory = false): void {
    const page = this.isPage;
    this.dialog.close(); document.body.classList.remove("editor-open");
    window.clearTimeout(this.timer); this.writer.unmount();
    query("#compose-layer").classList.remove("is-focused");
    document.getElementById("writer-history")?.remove();
    this.current = undefined; this.storageFailed = false;
    if (page) {
      query("#entry-form").append(query(".editor-footer"));
      this.dialog.append(...Array.from(this.page.childNodes)); this.page.hidden = true;
      document.body.classList.remove("note-writing", "writing-focus");
      query("#entry-repeat-field").before(this.courseField.closest("label")!);
      const close = query<HTMLElement>("[data-close-compose]", this.dialog);
      close.setAttribute("aria-label", "关闭编辑器"); close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    }
    this.onDraftChange();
    if (!page && !fromHistory && history.state?.jinrijiModal === "editor") history.back();
  }

  private error(message: string): void {
    const element = query<HTMLElement>("#entry-error");
    element.textContent = message; element.hidden = false;
  }

  prepareForUpdate(): boolean {
    if (this.busy || this.pending || this.writer.isWorking || this.isOpen && this.contents() !== (this.current?.type === "note" ? this.baseline : this.draftBaseline)) {
      if (!this.writer.isComposing) void this.flush(); showToast("正在保存，请稍后再更新"); return false;
    }
    return !this.storageFailed;
  }

  private snapshot(): Draft {
    return { ...this.current!, title: this.title.value, body: this.rich ? this.writer.text : this.body.value,
      document: this.rich ? this.writer.document : undefined, notebookId: this.notebook.value || undefined, cursor: this.writer.cursor, scroll: this.scroll,
      date: this.date.value, time: this.time.value, courseId: this.courseField.value || undefined,
      instructor: this.instructor.value, location: this.location.value, tagsText: this.tags.value,
      repeatFrequency: this.repeat.value as Draft["repeatFrequency"], updatedAt: new Date().toISOString() };
  }

  private changed(): void {
    if (!this.current || !this.isOpen || this.busy) return;
    window.clearTimeout(this.timer);
    query("#draft-status").textContent = this.conflict ? "尚未保存 · 有冲突" : "尚未保存";
    if (this.writer.isComposing) return;
    this.timer = window.setTimeout(() => { if (!this.conflict) void this.flush(); }, 600);
  }

  private flush(): Promise<boolean> {
    window.clearTimeout(this.timer);
    if (this.pending) return this.pending;
    if (!this.current || !this.isOpen) return Promise.resolve(true);
    if (this.writer.isComposing) return Promise.resolve(false);
    const promise = this.current.type === "note" ? this.commitNote() : this.persist();
    this.pending = promise;
    queryAll<HTMLButtonElement>("[data-entry-type]").forEach(button => button.disabled = true);
    void promise.then(ok => {
      this.pending = undefined;
      if (!this.busy) queryAll<HTMLButtonElement>("[data-entry-type]").forEach(button => button.disabled = false);
      // A slow IndexedDB commit may finish after the next debounce. Drain those edits too.
      if (ok && this.current && !this.busy && this.contents() !== (this.current.type === "note" ? this.baseline : this.draftBaseline)) this.changed();
    }, () => { this.pending = undefined; if (!this.busy) queryAll<HTMLButtonElement>("[data-entry-type]").forEach(button => button.disabled = false); });
    return promise;
  }

  private async commitNote(asNew = false): Promise<boolean> {
    if (!this.current) return true;
    const contents = this.contents();
    if (contents === this.baseline && !asNew) return true;
    const draft = this.snapshot();
    if (!draft.title.trim() && !draft.body.trim() && !JSON.stringify(draft.document).includes('"localImage"')) {
      if (draft.revision !== undefined) { this.error("请保留标题或正文；删除记录请在详情中操作。"); return false; }
      return true;
    }
    query("#draft-status").textContent = "保存中…";
    try {
      // Recovery is committed first. A conflict or failed item transaction never discards this copy.
      await this.drafts.save(draft); this.draftBaseline = contents;
      if (this.sourceKey) { await this.drafts.remove(this.sourceKey); this.sourceKey = undefined; }
      const tags = normalizeTags(draft.tagsText || "");
      const result = await this.writing.save({ kind: "note", title: draft.title.trim() || draft.body.trim().split(/\r?\n/)[0]?.slice(0, 120) || "图片笔记",
        document: draft.document, notebookId: draft.notebookId, body: draft.body, tags, courseId: draft.courseId, allDay: false },
        asNew ? crypto.randomUUID() : draft.id!, asNew ? undefined : draft.revision, this.checkpoint);
      this.current = { ...this.current, entity: "item", id: result.id, revision: result.revision, document: result.document };
      this.onNoteCommitted?.(result);
      query<HTMLElement>('[data-entry-type="course"]').hidden = true;
      query("#compose-title").textContent = "编辑便签";
      this.baseline = contents; this.checkpoint = false; this.conflict = false; this.storageFailed = false;
      query<HTMLElement>("#entry-error").hidden = true; query<HTMLElement>("#save-as-new").hidden = true;
      try {
        if (contents !== this.contents()) await this.drafts.save(this.snapshot());
        else await this.drafts.remove(this.current.key);
        if (this.sourceKey) { await this.drafts.remove(this.sourceKey); this.sourceKey = undefined; }
      } catch { showToast("正文已保存，恢复草稿未能清理；下次打开请核对版本。"); }
      query("#draft-status").textContent = contents === this.contents() ? "已保存到本机" : "尚未保存";
      void this.writing.remember(result.id, this.writer.cursor, this.scroll).catch(() => undefined);
      return true;
    } catch (cause) {
      this.storageFailed = true;
      const message = cause instanceof Error ? cause.message : "保存失败";
      this.conflict = /另一|副本|已移除|已变动/.test(message);
      this.error(cause instanceof Error && cause.name === "QuotaExceededError" ? "存储空间不足，当前输入仍保留。请导出正文，再释放空间重试。" : message);
      query("#draft-status").textContent = this.conflict ? "未保存 · 版本冲突" : "未保存 · 请重试";
      query<HTMLElement>("#save-as-new").hidden = false;
      return false;
    }
  }

  private async saveNote(close: boolean, asNew = false): Promise<void> {
    if (this.busy || !this.current || this.writer.isComposing || this.writer.isWorking) return;
    this.busy = true; window.clearTimeout(this.timer);
    const controls = queryAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>("button,input,textarea,select", this.surface);
    controls.forEach(control => control.disabled = true); this.writer.setBusy(true);
    try {
      if (this.pending) await this.pending;
      const ok = asNew ? await this.commitNote(true) : await this.flush();
      if (!ok) return;
      const id = this.current.id!;
      const saved = this.current.revision !== undefined;
      if (saved) await this.writing.remember(id, this.writer.cursor, this.scroll).catch(() => undefined);
      if (close) {
        const page = this.isPage;
        const scroll = this.scroll;
        this.finishClose();
        if (saved) await this.onSaved({ entity: "item", id });
        if (page) this.onPageDone?.(saved ? id : undefined, scroll);
      }
    } catch { this.error("刷新失败，内容仍保留。请重试或导出正文。"); }
    finally { this.busy = false; controls.forEach(control => control.disabled = false); this.writer.setBusy(false); }
  }

  private async showHistory(): Promise<void> {
    if (!this.current || this.busy) return;
    const id = this.current.id!;
    try {
      const versions = await this.writing.history(id);
      if (!this.current || this.current.id !== id) return;
      document.getElementById("writer-history")?.remove();
      const panel = document.createElement("section"); panel.id = "writer-history"; panel.className = "writer-history";
      panel.innerHTML = `<div class="card-heading"><h3>历史版本</h3><button type="button" class="text-button" data-history-close>关闭</button></div><p class="record-meta">每篇最多 20 份，全站最多 100 份；不替代备份。</p>${versions.length ? `<label>选择版本<select id="history-version">${versions.map((version, index) => `<option value="${index}">${escape(new Date(version.savedAt).toLocaleString())} · ${escape(version.item.title.slice(0, 30))}</option>`).join("")}</select></label><pre id="history-preview"></pre><button type="button" class="secondary-button" data-history-restore>恢复此版本</button>` : '<p>继续写作后，会保留此前的版本。</p>'}`;
      this.writer.root.before(panel);
      panel.querySelector("[data-history-close]")!.addEventListener("click", () => { panel.remove(); this.writer.focus(); });
      const select = panel.querySelector<HTMLSelectElement>("#history-version");
      const preview = (): void => { if (select) panel.querySelector("#history-preview")!.textContent = versions[Number(select.value)]!.item.body; };
      select?.addEventListener("change", preview); preview();
      panel.querySelector("[data-history-restore]")?.addEventListener("click", () => {
        const version = versions[Number(select!.value)]!;
        void confirmAction("恢复此版本？", "恢复前会保存当前正文，并保留恢复前的历史版本。", "恢复", async () => {
          if (this.pending) await this.pending;
          this.checkpoint = true;
          if (!await this.flush()) throw new Error("当前内容未能保存，请先重试或导出");
          this.checkpoint = true;
          this.title.value = version.item.title;
          this.writer.setDocument(version.item.document || textDocument(version.item.body));
          this.changed();
          if (!await this.flush()) throw new Error("恢复后的内容尚未保存，输入仍保留");
          panel.remove();
        });
      });
      select?.focus();
    } catch (cause) { this.error(cause instanceof Error ? cause.message : "历史版本读取失败"); }
  }

  private async save(asNew = false): Promise<void> {
    if (this.current?.type === "note") {
      if (!this.title.value.trim() && !this.writer.text.trim() && !JSON.stringify(this.writer.document).includes('"localImage"')) { this.error("请输入标题或内容"); this.writer.focus(); return; }
      try { normalizeTags(this.tags.value); }
      catch (cause) { this.error((cause as Error).message); query<HTMLDetailsElement>("#entry-organization").open = true; this.tags.focus(); return; }
      await this.saveNote(true, asNew); return;
    }
    if (this.busy || !this.current) return;
    const body = (this.rich ? this.writer.text : this.body.value).trim();
    const typedTitle = this.title.value.trim();
    const course = this.current.type === "course";
    if (!(course ? typedTitle || body : body || typedTitle)) {
      this.error(course ? "请输入课程名称" : "请输入标题或内容");
      (course ? this.title : this.body).focus(); return;
    }
    let schedule: ReturnType<typeof parseSchedule>;
    let tags: string[];
    try { tags = course ? [] : normalizeTags(this.tags.value); }
    catch (cause) {
      this.error((cause as Error).message);
      query<HTMLDetailsElement>("#entry-organization").open = true; this.tags.focus(); return;
    }
    try {
      schedule = parseSchedule(this.date.value, this.time.value);
      if (this.current.type === "schedule" && !this.date.value) throw new Error("请选择日程日期；没有日期的事项可以记为待办");
      if (this.current.type === "task" && this.repeat.value && !this.date.value) throw new Error("重复待办需要先选择日期");
    }
    catch (cause) { this.error((cause as Error).message); this.date.focus(); return; }
    const title = typedTitle || body.split(/\r?\n/)[0]!.slice(0, 120);
    this.busy = true;
    const controls = queryAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>("button, input, textarea, select", this.dialog);
    controls.forEach(control => control.disabled = true);
    const saveButton = query<HTMLButtonElement>("#save-entry");
    saveButton.textContent = "保存中…"; saveButton.setAttribute("aria-busy", "true");
    query<HTMLElement>("#entry-error").hidden = true;
    let saved: Selection | undefined;
    try {
      await this.flush();
      const editing = this.current.revision !== undefined && !asNew;
      const id = asNew ? crypto.randomUUID() : this.current.id;
      if (course) {
        const values = { name: title, firstMeetingAt: schedule.at, allDay: schedule.allDay, dateOnly: schedule.dateOnly, location: this.location.value.trim(), instructor: this.instructor.value.trim() };
        const result = editing ? await this.repository.updateCourse(id!, values, this.current.revision) : await this.repository.createCourse(values, id);
        if (!result) throw new Error("原课程已不存在，请另存为新记录");
        saved = { entity: "course", id: result.id };
      } else {
        const kind: Item["kind"] = this.current.type === "schedule" ? "event" : this.current.type as "note" | "task";
        const frequency = this.repeat.value as NonNullable<Item["repeat"]>["frequency"];
        const repeat = kind === "task" && frequency ? this.current.repeat?.frequency === frequency && this.date.value === this.current.repeatSourceDate && !asNew
          ? this.current.repeat : { frequency, anchorDate: this.date.value, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : undefined;
        const values = { title, body: body || typedTitle, document: this.rich ? this.writer.document : undefined, kind, dueAt: kind === "task" ? schedule.at : undefined,
          startAt: kind === "event" ? schedule.at : undefined, allDay: schedule.allDay, dateOnly: schedule.dateOnly, courseId: this.courseField.value || undefined, tags, repeat };
        const result = editing ? await this.repository.updateItem(id!, values, this.current.revision) : await this.repository.createItem(values, id);
        if (!result) throw new Error("原记录已不存在，请另存为新记录");
        saved = { entity: "item", id: result.id };
      }
      try { await this.drafts.remove(this.current.key); if (this.sourceKey) await this.drafts.remove(this.sourceKey); }
      catch { showToast("记录已保存，但旧草稿未能清理"); }
      this.finishClose();
    } catch (cause) {
      this.error(cause instanceof Error && cause.name === "QuotaExceededError" ? "存储空间不足，输入仍保留。请释放空间后重试，或先复制内容。"
        : cause instanceof Error && cause.name !== "ConstraintError" ? cause.message : "这条记录可能已保存，请关闭后查看；输入仍保留。");
      query<HTMLElement>("#save-as-new").hidden = this.current?.revision === undefined;
    } finally {
      this.busy = false;
      controls.forEach(control => control.disabled = false);
      saveButton.textContent = "保存记录"; saveButton.removeAttribute("aria-busy");
    }
    if (saved) {
      try { await this.onSaved(saved); }
      catch { showToast("已保存，请刷新查看"); }
    }
  }
}

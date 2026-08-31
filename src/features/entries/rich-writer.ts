import { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { addRowAfter, addColumnAfter, deleteRow, deleteColumn, deleteTable } from "@tiptap/pm/tables";
import { characterCount, documentMarkdown, documentText, MAX_NOTE_LENGTH, noteExtensions, safeLink, textDocument, validateDocument, type NoteDocument } from "../../domain/note-document";
import { query, queryAll, safeHTML as escape } from "../../ui/dom";
import type { Item } from "../../domain/models";
import { hydrateImages } from "./local-images";

const button = (action: string, label: string, symbol = label): string => `<button type="button" data-write="${action}" aria-label="${label}" title="${label}">${symbol}</button>`;

/** Owns only editing and tools; persistence remains in EntryEditor. */
export class RichWriter {
  readonly root = document.createElement("section");
  editor?: Editor;
  notes: Item[] = [];
  onSelectionTask?: (text: string) => Promise<void>;
  onImage?: (file: File) => Promise<string>;
  private operation = false;
  private plainPaste = false;
  private composing = false;
  private matches: { from: number; to: number }[] = [];
  private matchIndex = -1;
  private selection = { from: 1, to: 1 };
  private readonly limitExtension = Extension.create({
    name: "boundedDocument",
    addProseMirrorPlugins: () => [new Plugin({ filterTransaction: tr => {
      if (!tr.docChanged) return true;
      let table = false; tr.doc.descendants(node => { if (node.type.name === "table") table = true; return !table; });
      if (table) { try { validateDocument(tr.doc.toJSON()); } catch (cause) { this.onError(cause instanceof Error ? cause.message : "表格不受支持"); return false; } }
      // Do not serialize the whole tree for every keystroke; full validation happens at commit.
      if (tr.doc.textBetween(0, tr.doc.content.size, "\n", "\n").length <= MAX_NOTE_LENGTH) return true;
      this.onError("每篇正文最多 200,000 字符；本次输入未加入，可先导出再分篇。"); return false;
    } })],
  });

  constructor(private readonly onChange: () => void, private readonly onError: (text: string) => void,
    private readonly onHistory: () => void, private readonly title: () => string) {
    this.root.className = "writer"; this.root.hidden = true;
    this.root.innerHTML = `<div class="writer-chrome"><div class="writer-toolbar" role="toolbar" aria-label="正文格式">
      ${button("heading", "标题", "H₂")}${button("bold", "加粗", "<b>B</b>")}${button("italic", "斜体", "<i>I</i>")}${button("strike", "删除线", "<s>S</s>")}${button("highlight", "高亮", "<u>A</u>")}
      ${button("bulletList", "项目列表", "• ≡")}${button("orderedList", "编号列表", "1. ≡")}${button("taskList", "勾选清单", "☑")}${button("blockquote", "引用", "❞")}${button("link", "链接", "↗")}${button("rule", "分隔线", "—")}
      ${button("undo", "撤销", "↶")}${button("redo", "重做", "↷")}
    </div><div class="writer-tools" aria-label="写作工具">${button("find", "查找替换", "查找")}${button("focus", "专注写作", "专注")}${button("serif", "衬线正文", "宋")}${button("spacing", "宽松行距", "行距")}${button("plain", "纯文本粘贴", "纯文本粘贴")}${button("history", "历史版本", "历史")}<label class="writer-export">导出<select id="writer-export" aria-label="导出正文"><option value="">选择格式</option><option value="txt">纯文本 .txt</option><option value="md">Markdown .md</option></select></label></div>
    </div><div class="writer-find" hidden><label>查找<input id="writer-find-text" type="search" autocomplete="off"></label><label>替换<input id="writer-replace-text" autocomplete="off"></label><div>${button("next", "下一处")}${button("replace", "替换此处")}${button("replace-all", "全部替换")}${button("close-find", "关闭查找", "关闭")}<span id="writer-matches" role="status"></span></div></div>
    <div class="writer-link" hidden><label>链接地址<input id="writer-link-url" type="url" placeholder="https://" autocomplete="off"></label>${button("apply-link", "应用链接", "应用")}${button("unlink", "移除链接", "移除")}${button("close-link", "关闭链接设置", "取消")}</div>
    <div id="writer-canvas"></div><div class="writer-count" id="writer-count" aria-label="正文统计"></div>`;
    query("#quick-entry").after(this.root);
    const tools = query<HTMLElement>(".writer-tools", this.root);
    const more = document.createElement("details"); more.className = "writer-more";
    more.innerHTML = '<summary>更多</summary>'; tools.before(more); more.append(tools);
    tools.insertAdjacentHTML("afterbegin", `${button("note-link", "链接笔记", "笔记链接")}${button("selection-task", "选段转待办")}${button("image", "插入图片", "图片")}${button("table", "插入表格", "表格")}`);
    this.root.insertAdjacentHTML("beforeend", '<input type="file" id="writer-image" accept="image/png,image/jpeg,image/webp" hidden>');
    query(".writer-chrome", this.root).insertAdjacentHTML("afterend", `<div class="writer-insert" hidden><label>链接到笔记<input type="search" id="note-link-search" placeholder="搜索笔记" autocomplete="off"></label><div id="note-link-results"></div>${button("unlink-note", "移除笔记链接")}${button("close-insert", "关闭插入", "关闭")}</div><div class="table-tools" hidden>${button("row-add", "在下方添加行", "+ 行")}${button("column-add", "在右侧添加列", "+ 列")}${button("row-delete", "删除当前行", "删行")}${button("column-delete", "删除当前列", "删列")}${button("table-delete", "删除表格")}</div>`);
    query("#note-link-search").addEventListener("input", () => this.renderNoteLinks());
    query("#note-link-results").addEventListener("click", event => {
      const id = (event.target as Element).closest<HTMLElement>("[data-insert-note]")?.dataset.insertNote;
      const note = this.notes.find(note => note.id === id); if (!note || !this.editor) return;
      this.focus(); const chain = this.editor.chain().setTextSelection(this.selection).unsetLink();
      if (this.selection.from === this.selection.to) chain.insertContent({ type: "text", text: note.title, marks: [{ type: "noteLink", attrs: { noteId: id } }] }).run();
      else chain.setMark("noteLink", { noteId: id }).run();
      this.editor.chain().setTextSelection(this.editor.state.selection.to).unsetMark("noteLink").run(); query<HTMLElement>(".writer-insert").hidden = true;
    });
    query("#writer-image").addEventListener("change", event => {
      const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = "";
      if (!file || !this.onImage || !this.editor) return;
      const editor = this.editor;
      const cursor = editor.state.selection.$from;
      const position = cursor.depth ? cursor.after(1) : editor.state.doc.content.size;
      void this.perform(async () => {
        const id = await this.onImage!(file);
        if (this.editor !== editor || editor.isDestroyed) return;
        editor.chain().insertContentAt(position, [{ type: "localImage", attrs: { assetId: id, alt: file.name.slice(0, 500) } }, { type: "paragraph" }]).run();
        hydrateImages(this.root);
      });
    });
    this.root.addEventListener("pointerdown", event => {
      if ((event.target as Element).closest(".writer-toolbar button,.writer-tools button,.table-tools button")) event.preventDefault();
    });
    this.root.addEventListener("click", event => {
      const action = (event.target as Element).closest<HTMLElement>("[data-write]")?.dataset.write;
      if (action) { try { this.act(action); } catch (cause) { this.onError(cause instanceof Error ? cause.message : "此操作暂不可用"); } }
    });
    this.root.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.isComposing || !(event.target instanceof HTMLInputElement)) return;
      event.preventDefault(); event.stopPropagation();
      this.act(event.target.id === "writer-link-url" ? "apply-link" : event.target.id === "writer-replace-text" ? "replace" : "next");
    });
    query("#writer-find-text").addEventListener("input", () => { this.matchIndex = -1; this.find(); });
    query<HTMLSelectElement>("#writer-export").addEventListener("change", event => {
      const select = event.target as HTMLSelectElement;
      if (select.value) this.export(select.value === "md" ? "md" : "txt"); select.value = "";
    });
  }

  get isComposing(): boolean { return this.composing || Boolean(this.editor?.view.composing); }
  get isWorking(): boolean { return this.operation; }
  get document(): NoteDocument { return this.editor?.getJSON() || textDocument(""); }
  get text(): string { return documentText(this.document); }
  get cursor(): number { return this.editor?.state.selection.from || 1; }

  mount(doc: NoteDocument, cursor = 1): void {
    validateDocument(doc); this.editor?.destroy(); this.composing = false;
    query<HTMLElement>(".writer-find").hidden = true; query<HTMLElement>(".writer-link").hidden = true;
    query<HTMLElement>(".writer-insert").hidden = true; query<HTMLDetailsElement>(".writer-more").open = false;
    this.editor = new Editor({ element: query("#writer-canvas"), extensions: [...noteExtensions(), this.limitExtension], content: doc,
      editorProps: {
        attributes: { role: "textbox", "aria-label": "便签正文", "aria-multiline": "true", spellcheck: "true", "data-placeholder": "写点什么…" },
        handleDOMEvents: {
          compositionstart: () => { this.composing = true; return false; },
          compositionend: () => { this.composing = false; window.setTimeout(() => this.onChange(), 0); return false; },
        },
        handlePaste: (_view, event) => {
          if (!this.plainPaste) return false;
          const text = event.clipboardData?.getData("text/plain");
          if (text === undefined) return false;
          this.editor!.commands.insertContent(textDocument(text).content!); return true;
        },
      },
      onUpdate: () => { this.updateTools(); this.find(); hydrateImages(this.root); this.onChange(); },
      onSelectionUpdate: () => this.updateTools(),
    });
    this.editor.commands.setTextSelection(Math.max(1, Math.min(cursor, this.editor.state.doc.content.size - 1)));
    try {
      this.root.classList.toggle("serif-prose", localStorage.getItem("jinriji:writer:serif") === "true");
      this.root.classList.toggle("roomy-prose", localStorage.getItem("jinriji:writer:spacing") === "true");
    } catch { /* Optional presentation preference. */ }
    this.updateTools();
    hydrateImages(this.root);
  }
  // Vanilla DOM is already mounted. A delayed framework focus can overwrite the
  // user's next selection (for example immediate select-all/paste after opening).
  focus(): void { this.editor?.view.focus(); }
  setDocument(doc: NoteDocument): void { validateDocument(doc); this.editor?.commands.setContent(doc); }
  unmount(): void { this.editor?.destroy(); this.editor = undefined; }

  private updateTools(): void {
    if (!this.editor) return;
    const selection = this.editor.state.selection;
    this.editor.view.dom.classList.toggle("is-empty", this.editor.isEmpty);
    const selected = characterCount(this.editor.state.doc.textBetween(selection.from, selection.to, "\n"));
    query("#writer-count").textContent = `${characterCount(this.text).toLocaleString()} 字符${selected ? ` · 已选 ${selected.toLocaleString()}` : ""}`;
    query("#writer-count").setAttribute("title", "不含空白，汉字、字母及标点各计一个字符");
    for (const name of ["heading", "bold", "italic", "strike", "highlight", "bulletList", "orderedList", "taskList", "blockquote"]) {
      query(`[data-write="${name}"]`).setAttribute("aria-pressed", String(this.editor.isActive(name)));
    }
    query<HTMLButtonElement>('[data-write="undo"]').disabled = !this.editor.can().undo();
    query<HTMLButtonElement>('[data-write="redo"]').disabled = !this.editor.can().redo();
    query<HTMLButtonElement>('[data-write="selection-task"]').disabled = !selected || this.operation;
    query<HTMLElement>(".table-tools").hidden = !this.editor.isActive("table");
    for (const [name, state] of [["serif", this.root.classList.contains("serif-prose")], ["spacing", this.root.classList.contains("roomy-prose")], ["plain", this.plainPaste], ["focus", document.body.classList.contains("writing-focus")]] as const) query(`[data-write="${name}"]`).setAttribute("aria-pressed", String(state));
  }

  private act(action: string): void {
    if (!this.editor || this.isComposing || this.operation) return;
    this.focus(); const chain = this.editor.chain();
    switch (action) {
      case "heading": chain.toggleHeading({ level: 2 }).run(); break;
      case "bold": chain.toggleBold().run(); break;
      case "italic": chain.toggleItalic().run(); break;
      case "strike": chain.toggleStrike().run(); break;
      case "highlight": chain.toggleHighlight().run(); break;
      case "bulletList": chain.toggleBulletList().run(); break;
      case "orderedList": chain.toggleOrderedList().run(); break;
      case "taskList": chain.toggleTaskList().run(); break;
      case "blockquote": chain.toggleBlockquote().run(); break;
      case "rule": chain.setHorizontalRule().run(); break;
      case "undo": chain.undo().run(); break;
      case "redo": chain.redo().run(); break;
      case "find": query<HTMLElement>(".writer-find").hidden = !query<HTMLElement>(".writer-find").hidden; query<HTMLInputElement>("#writer-find-text").focus(); break;
      case "close-find": query<HTMLElement>(".writer-find").hidden = true; this.focus(); break;
      case "next": this.next(); break;
      case "replace": this.replace(false); break;
      case "replace-all": this.replace(true); break;
      case "focus": document.body.classList.toggle("writing-focus"); break;
      case "note-link":
        this.selection = { from: this.editor.state.selection.from, to: this.editor.state.selection.to };
        query<HTMLElement>(".writer-insert").hidden = false; this.renderNoteLinks(); query<HTMLInputElement>("#note-link-search").focus(); break;
      case "unlink-note": chain.setTextSelection(this.selection).extendMarkRange("noteLink").unsetMark("noteLink").run(); query<HTMLElement>(".writer-insert").hidden = true; break;
      case "close-insert": query<HTMLElement>(".writer-insert").hidden = true; this.focus(); break;
      case "selection-task": {
        const text = this.editor.state.doc.textBetween(this.editor.state.selection.from, this.editor.state.selection.to, "\n").trim();
        if (text && this.onSelectionTask) void this.perform(() => this.onSelectionTask!(text)); break;
      }
      case "image": query<HTMLInputElement>("#writer-image").click(); break;
      case "table":
        if (this.editor.isActive("table")) { this.onError("请先将光标移到表格外"); break; }
        chain.insertContent([{ type: "table", content: Array.from({ length: 3 }, (_, index) => ({ type: "tableRow", content: Array.from({ length: 3 }, () => ({ type: index ? "tableCell" : "tableHeader", content: [{ type: "paragraph" }] })) })) }, { type: "paragraph" }]).run(); break;
      case "row-add": case "column-add": case "row-delete": case "column-delete": case "table-delete": {
        const command = { "row-add": addRowAfter, "column-add": addColumnAfter, "row-delete": deleteRow, "column-delete": deleteColumn, "table-delete": deleteTable }[action];
        command(this.editor.state, tr => { validateDocument(tr.doc.toJSON()); this.editor!.view.dispatch(tr); }); break;
      }
      case "serif": case "spacing": {
        const enabled = this.root.classList.toggle(action === "serif" ? "serif-prose" : "roomy-prose");
        try { localStorage.setItem(`jinriji:writer:${action}`, String(enabled)); } catch { /* Editing remains available. */ }
        break;
      }
      case "plain": this.plainPaste = !this.plainPaste; break;
      case "history": this.onHistory(); break;
      case "link":
        this.selection = { from: this.editor.state.selection.from, to: this.editor.state.selection.to };
        query<HTMLElement>(".writer-link").hidden = false;
        query<HTMLInputElement>("#writer-link-url").value = this.editor.getAttributes("link").href || "";
        query<HTMLInputElement>("#writer-link-url").focus(); break;
      case "apply-link": {
        const href = query<HTMLInputElement>("#writer-link-url").value.trim();
        if (!safeLink(href)) { this.onError("链接需要以 https://、http:// 或 mailto: 开头。"); return; }
        const cmd = chain.setTextSelection(this.selection);
        if (this.selection.from === this.selection.to && !this.editor.isActive("link")) cmd.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
        else cmd.extendMarkRange("link").setLink({ href }).run();
        query<HTMLElement>(".writer-link").hidden = true; break;
      }
      case "unlink": chain.setTextSelection(this.selection).extendMarkRange("link").unsetLink().run(); query<HTMLElement>(".writer-link").hidden = true; break;
      case "close-link": query<HTMLElement>(".writer-link").hidden = true; this.focus(); break;
    }
    this.updateTools();
  }

  private renderNoteLinks(): void {
    const needle = query<HTMLInputElement>("#note-link-search").value.trim().toLocaleLowerCase();
    const notes = this.notes.filter(note => note.kind === "note" && !note.deletedAt && (note.title + note.body).toLocaleLowerCase().includes(needle)).slice(0, 30);
    query("#note-link-results").innerHTML = notes.length ? notes.map(note => `<button type="button" data-insert-note="${escape(note.id)}">${escape(note.title)}</button>`).join("") : '<p class="record-meta">没有可链接的笔记</p>';
  }
  private async perform(action: () => Promise<void>): Promise<void> {
    if (this.operation) return; this.operation = true; this.setBusy(true);
    try { await action(); } catch (cause) { this.onError(cause instanceof Error ? cause.message : "操作失败，正文仍保留"); }
    finally { this.operation = false; this.setBusy(false); }
  }

  private find(): void {
    if (!this.editor) return;
    const needle = query<HTMLInputElement>("#writer-find-text").value;
    this.matches = [];
    if (needle) this.editor.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return;
      const text = node.textBetween(0, node.content.size, "", "\n");
      let start = 0;
      while ((start = text.indexOf(needle, start)) !== -1) { this.matches.push({ from: pos + 1 + start, to: pos + 1 + start + needle.length }); start += needle.length; }
      return false;
    });
    this.matchIndex = Math.min(this.matchIndex, this.matches.length - 1);
    query("#writer-matches").textContent = needle ? `${this.matchIndex + 1} / ${this.matches.length}` : "";
  }
  private next(): void {
    this.find(); if (!this.matches.length) return;
    this.matchIndex = (this.matchIndex + 1) % this.matches.length;
    this.editor!.commands.setTextSelection(this.matches[this.matchIndex]!);
    this.editor!.commands.scrollIntoView();
    query("#writer-matches").textContent = `${this.matchIndex + 1} / ${this.matches.length}`;
  }
  private replace(all: boolean): void {
    this.find(); if (!this.editor || !this.matches.length) return;
    if (this.matchIndex < 0) { this.next(); if (!all) return; }
    const replacement = query<HTMLInputElement>("#writer-replace-text").value;
    const ranges = all ? this.matches : [this.matches[this.matchIndex]!];
    const tr = this.editor.state.tr;
    for (const range of [...ranges].reverse()) tr.insertText(replacement, range.from, range.to);
    this.editor.view.dispatch(tr); this.matchIndex = -1; this.find();
  }

  export(format: "txt" | "md"): void {
    try {
      const text = format === "md" ? documentMarkdown(this.document) : this.text;
      const title = this.title().trim();
      const heading = format === "md" ? `# ${title.replace(/([\\#*_\[\]])/g, "\\$1")}\n\n` : `${title}\n\n`;
      const url = URL.createObjectURL(new Blob([title ? heading : "", text], { type: "text/plain;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = `${(title || "未命名").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80)}.${format}`;
      a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { this.onError(error instanceof Error ? error.message : "导出失败，请先复制正文"); }
  }

  setBusy(busy: boolean): void {
    this.editor?.setEditable(!busy);
    queryAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select", this.root).forEach(control => control.disabled = busy);
    if (!busy) this.updateTools();
  }
}

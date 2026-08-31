import { getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Highlight from "@tiptap/extension-highlight";
import { organizationExtensions } from "./note-nodes";

export type NoteDocument = JSONContent;
export const MAX_NOTE_LENGTH = 200_000;
export const safeLink = (href: string): boolean => /^(https?:\/\/|mailto:)/i.test(href) && !/[\u0000-\u0020\u007f]/.test(href);
export const noteExtensions = () => [StarterKit.configure({ heading: { levels: [1, 2, 3] },
  link: { openOnClick: false, autolink: false, defaultProtocol: "https", isAllowedUri: url => safeLink(url) },
}), TaskList, TaskItem.configure({ nested: true }), Highlight, ...organizationExtensions()];
const schema = getSchema(noteExtensions());

/** Legacy text is literal. Never interpret its Markdown punctuation on migration. */
export function textDocument(text: string): NoteDocument {
  return { type: "doc", content: text.split(/\r?\n/).map(line => ({ type: "paragraph", ...(line ? { content: [{ type: "text", text: line }] } : {}) })) };
}

export function documentText(doc: NoteDocument): string {
  const parsed = schema.nodeFromJSON(doc);
  return parsed.textBetween(0, parsed.content.size, "\n", "\n");
}

/** Validate bounded schema and attributes before data enters storage or rendering. */
export function validateDocument(value: unknown): asserts value is NoteDocument {
  let count = 0;
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || Array.isArray(node) || depth > 32 || ++count > 250_000) throw new Error("正文结构无效或过于复杂");
    const n = node as JSONContent;
    if (typeof n.type !== "string" || !schema.nodes[n.type]) throw new Error("正文含不支持的内容");
    if (n.attrs && Object.keys(n.attrs).some(key => !["level", "start", "type", "checked", "language", "assetId", "alt", "colspan", "rowspan", "colwidth"].includes(key))) throw new Error("正文字段无效");
    if (n.type === "localImage" && (typeof n.attrs?.assetId !== "string" || !/^[\w-]{1,128}$/.test(n.attrs.assetId) || typeof n.attrs.alt !== "string" || n.attrs.alt.length > 500)) throw new Error("图片引用无效");
    if (n.type === "table" && (!n.content?.length || n.content.length > 20 || n.content.some(row => !row.content?.length || row.content.length > 8 || row.content.length !== n.content![0]!.content!.length))) throw new Error("表格最多 20 行、8 列，且每行列数需相同");
    if (["tableCell", "tableHeader"].includes(n.type) && ((n.attrs?.colspan ?? 1) !== 1 || (n.attrs?.rowspan ?? 1) !== 1 || n.attrs?.colwidth != null)) throw new Error("暂不支持合并单元格");
    if (n.attrs?.level !== undefined && ![1, 2, 3].includes(n.attrs.level)) throw new Error("标题级别无效");
    if (n.attrs?.start !== undefined && (!Number.isSafeInteger(n.attrs.start) || n.attrs.start < 1 || n.attrs.start > 1_000_000)) throw new Error("列表编号无效");
    if (n.attrs?.checked !== undefined && typeof n.attrs.checked !== "boolean") throw new Error("清单状态无效");
    if (n.marks !== undefined && !Array.isArray(n.marks)) throw new Error("正文格式无效");
    for (const mark of n.marks || []) {
      if (!schema.marks[mark.type]) throw new Error("正文格式不受支持");
      if (mark.type === "link") {
        if (typeof mark.attrs?.href !== "string" || mark.attrs.href.length > 4096 || !safeLink(mark.attrs.href)) throw new Error("链接只支持 http、https 或 mailto");
        if (Object.keys(mark.attrs).some(key => !["href", "target", "rel", "class", "title"].includes(key))) throw new Error("链接字段无效");
      } else if (mark.type === "noteLink") {
        if (typeof mark.attrs?.noteId !== "string" || !mark.attrs.noteId.trim() || mark.attrs.noteId.length > 512 || Object.keys(mark.attrs).some(key => key !== "noteId")) throw new Error("笔记链接无效");
      } else if (mark.attrs && Object.keys(mark.attrs).some(key => key !== "color" || mark.attrs![key] !== null)) throw new Error("正文格式字段无效");
    }
    if (n.content !== undefined && !Array.isArray(n.content)) throw new Error("正文内容无效");
    for (const child of n.content || []) visit(child, depth + 1);
  };
  visit(value, 0);
  if ((value as JSONContent).type !== "doc") throw new Error("正文缺少文档根节点");
  const parsed = schema.nodeFromJSON(value); parsed.check();
  if (parsed.textBetween(0, parsed.content.size, "\n", "\n").length > MAX_NOTE_LENGTH || JSON.stringify(value).length > 8_000_000) throw new Error("每篇正文最多 200,000 字符");
}

const escape = (text: string): string => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function documentHTML(doc: NoteDocument): string {
  validateDocument(doc);
  const render = (node: JSONContent): string => {
    let content = (node.content || []).map(render).join("");
    if (node.type === "text") {
      content = escape(node.text || "");
      for (const mark of node.marks || []) {
        if (mark.type === "link") content = `<a href="${escape(mark.attrs!.href)}" target="_blank" rel="noopener noreferrer">${content}</a>`;
        else if (mark.type === "noteLink") content = `<a class="note-link" data-note-id="${escape(mark.attrs!.noteId)}" href="#notes/item/${encodeURIComponent(mark.attrs!.noteId)}">${content}</a>`;
        else { const tag = ({ bold: "strong", italic: "em", strike: "s", underline: "u", code: "code", highlight: "mark" } as Record<string, string>)[mark.type]; if (tag) content = `<${tag}>${content}</${tag}>`; }
      }
      return content;
    }
    if (node.type === "localImage") return `<figure class="note-image"><img data-local-image="${escape(node.attrs!.assetId)}" alt="${escape(node.attrs!.alt)}"></figure>`;
    const tag = ({ paragraph: "p", blockquote: "blockquote", bulletList: "ul", orderedList: "ol", listItem: "li", taskList: "ul", taskItem: "li", codeBlock: "pre", table: "table", tableRow: "tr", tableCell: "td", tableHeader: "th" } as Record<string, string>)[node.type!] || (node.type === "heading" ? `h${node.attrs?.level || 2}` : "");
    if (node.type === "horizontalRule") return "<hr>";
    if (node.type === "hardBreak") return "<br>";
    const attrs = node.type === "taskList" ? ' class="read-checklist"' : node.type === "taskItem" ? ` data-checked="${Boolean(node.attrs?.checked)}"` : node.type === "orderedList" ? ` start="${Number(node.attrs?.start || 1)}"` : "";
    return tag ? `<${tag}${attrs}>${node.type === "taskItem" ? `<span aria-label="${node.attrs?.checked ? "已勾选" : "未勾选"}">${node.attrs?.checked ? "☑" : "☐"}</span>` : ""}${content}</${tag}>` : content;
  };
  return render(doc);
}

export function documentMarkdown(doc: NoteDocument): string {
  validateDocument(doc);
  const render = (n: JSONContent): string => {
    let text = (n.content || []).map(render).join("");
    if (n.type === "text") {
      text = (n.text || "").replace(/([\\`*_{}\[\]<>#+.!|~-])/g, "\\$1");
      for (const m of n.marks || []) {
        if (m.type === "bold") text = `**${text}**`;
        if (m.type === "italic") text = `*${text}*`;
        if (m.type === "strike") text = `~~${text}~~`;
        if (m.type === "code") { const raw = n.text || ""; const fence = "`".repeat(Math.max(0, ...(raw.match(/`+/g) || []).map(s => s.length)) + 1); text = `${fence} ${raw} ${fence}`; }
        if (m.type === "link") text = `[${text}](<${m.attrs!.href.replace(/</g, "%3C").replace(/>/g, "%3E")}>)`;
        if (m.type === "noteLink") text = `[${text}](#notes/item/${encodeURIComponent(m.attrs!.noteId)})`;
      }
      return text;
    }
    if (n.type === "paragraph") return text + "\n\n";
    if (n.type === "heading") return "#".repeat(n.attrs?.level || 2) + " " + text + "\n\n";
    if (n.type === "hardBreak") return "  \n";
    if (n.type === "horizontalRule") return "\n---\n\n";
    if (n.type === "localImage") return `[本地图片：${n.attrs!.alt || "图片"}；图片本体包含在完整备份中]\n\n`;
    if (n.type === "table") {
      const rows = n.content!.map(row => "| " + row.content!.map(cell => render(cell).trim().replace(/\n+/g, "<br>")).join(" | ") + " |");
      rows.splice(1, 0, "| " + n.content![0]!.content!.map(() => "---").join(" | ") + " |");
      return rows.join("\n") + "\n\n";
    }
    if (n.type === "blockquote") return text.trimEnd().split("\n").map(line => `> ${line}`).join("\n") + "\n\n";
    if (n.type === "codeBlock") { const raw = documentText({ type: "doc", content: [n] }); const fence = "`".repeat(Math.max(2, ...(raw.match(/`+/g) || []).map(s => s.length)) + 1); return `${fence}\n${raw}\n${fence}\n\n`; }
    if (["bulletList", "orderedList", "taskList"].includes(n.type!)) return (n.content || []).map((child, i) => {
      const prefix = n.type === "orderedList" ? `${(n.attrs?.start || 1) + i}. ` : n.type === "taskList" ? `- [${child.attrs?.checked ? "x" : " "}] ` : "- ";
      return prefix + render(child).trimEnd().replace(/\n/g, "\n" + " ".repeat(prefix.length));
    }).join("\n") + "\n\n";
    return text;
  };
  return render(doc).trimEnd() + "\n";
}

export const characterCount = (text: string): number => Array.from(text.replace(/\s/g, "")).length;

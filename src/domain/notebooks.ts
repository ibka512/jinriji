import type { NoteDocument } from "./note-document";

export interface Notebook { id: string; name: string; createdAt: string; updatedAt: string; revision: number; deletedAt?: string }
export interface NoteAsset { id: string; dataUrl: string; width: number; height: number; createdAt: string }
export const nameNotebook = (value: string): string => {
  const name = value.trim(); if (!name || name.length > 40) throw new Error("笔记本名称需要 1–40 个字符"); return name;
};
export function validateAsset(asset: NoteAsset): void {
  if (!asset || typeof asset.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(asset.id) || typeof asset.dataUrl !== "string" ||
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(asset.dataUrl) || asset.dataUrl.length > 699_050 ||
    !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width < 1 || asset.height < 1 || asset.width > 1600 || asset.height > 1600 || !Number.isFinite(Date.parse(asset.createdAt))) throw new Error("图片数据无效或超出限制");
  const encoded = asset.dataUrl.split(",")[1]!;
  const bytes = atob(encoded);
  const valid = asset.dataUrl.startsWith("data:image/png") ? bytes.startsWith("\x89PNG\r\n\x1a\n")
    : asset.dataUrl.startsWith("data:image/jpeg") ? bytes.startsWith("\xff\xd8\xff") : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
  if (!valid) throw new Error("图片文件类型与内容不一致");
}
export function documentReferences(doc?: NoteDocument): { notes: Set<string>; assets: Set<string> } {
  const notes = new Set<string>(); const assets = new Set<string>();
  const visit = (n: NoteDocument): void => { if (n.type === "localImage" && n.attrs?.assetId) assets.add(n.attrs.assetId); for (const m of n.marks || []) if (m.type === "noteLink") notes.add(m.attrs!.noteId); n.content?.forEach(visit); };
  if (doc) visit(doc); return { notes, assets };
}
const paragraph = (text = ""): NoteDocument => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) });
const heading = (text: string): NoteDocument => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
export const noteTemplates = [
  { id: "blank", name: "空白笔记", title: "", content: [paragraph()] },
  { id: "journal", name: "每日记录", title: "今日随笔", content: [heading("今天"), paragraph(), heading("想记住的事"), paragraph(), heading("明天"), paragraph()] },
  { id: "lecture", name: "课堂笔记", title: "课堂笔记", content: [heading("要点"), paragraph(), heading("理解与例子"), paragraph(), heading("待解决的问题"), paragraph()] },
  { id: "reading", name: "读书摘录", title: "读书笔记", content: [heading("书名与页码"), paragraph(), heading("摘录"), { type: "blockquote", content: [paragraph()] }, heading("我的想法"), paragraph()] },
];
export function templateDocument(id: string): { title: string; document: NoteDocument } {
  const template = noteTemplates.find(t => t.id === id); if (!template) throw new Error("模板不存在");
  return { title: template.title, document: { type: "doc", content: structuredClone(template.content) } };
}

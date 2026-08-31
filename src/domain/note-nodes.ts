import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import { tableEditing } from "@tiptap/pm/tables";

export const NoteLink = Mark.create({ name: "noteLink", inclusive: false, excludes: "link",
  addAttributes: () => ({ noteId: { default: null } }),
  parseHTML: () => [{ tag: "a[data-note-id]", getAttrs: element => ({ noteId: element.getAttribute("data-note-id") }) }],
  renderHTML: ({ mark }) => ["a", { "data-note-id": mark.attrs.noteId, href: `#notes/item/${encodeURIComponent(mark.attrs.noteId)}`, class: "note-link" }, 0],
});
export const LocalImage = Node.create({ name: "localImage", group: "block", atom: true, draggable: true,
  addAttributes: () => ({ assetId: { default: null }, alt: { default: "" } }),
  // Web images are deliberately not imported through HTML paste.
  parseHTML: () => [],
  renderHTML: ({ node }) => ["figure", { "data-asset-id": node.attrs.assetId, class: "note-image" }, ["img", { alt: node.attrs.alt, "data-local-image": node.attrs.assetId }]],
  addNodeView: () => ({ node }) => {
    const dom = document.createElement("figure"); dom.className = "note-image"; dom.dataset.assetId = node.attrs.assetId;
    const image = document.createElement("img"); image.alt = node.attrs.alt; image.dataset.localImage = node.attrs.assetId; dom.append(image);
    // Hydrating src/dimensions must not reparse surrounding table/document content.
    return { dom, ignoreMutation: () => true };
  },
});
const Table = Node.create({ name: "table", group: "block", content: "tableRow+", isolating: true,
  parseHTML: () => [{ tag: "table" }], renderHTML: ({ HTMLAttributes }) => ["table", mergeAttributes(HTMLAttributes, { class: "note-table" }), ["tbody", 0]],
});
const TableRow = Node.create({ name: "tableRow", content: "(tableCell | tableHeader)+",
  parseHTML: () => [{ tag: "tr" }], renderHTML: () => ["tr", 0],
});
const attrs = () => ({ colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } });
const TableCell = Node.create({ name: "tableCell", content: "paragraph+", isolating: true, addAttributes: attrs,
  parseHTML: () => [{ tag: "td" }], renderHTML: () => ["td", 0],
});
const TableHeader = Node.create({ name: "tableHeader", content: "paragraph+", isolating: true, addAttributes: attrs,
  parseHTML: () => [{ tag: "th" }], renderHTML: () => ["th", { scope: "col" }, 0],
});
const TableBehavior = Extension.create({ name: "basicTables",
  extendNodeSchema: extension => ({ tableRole: ({ table: "table", tableRow: "row", tableCell: "cell", tableHeader: "header_cell" } as Record<string, string>)[extension.name] }),
  addProseMirrorPlugins: () => [tableEditing()],
});
export const organizationExtensions = () => [NoteLink, LocalImage, Table, TableRow, TableCell, TableHeader, TableBehavior];

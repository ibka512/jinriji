import type { NoteAsset } from "../../domain/notebooks";
const images = new Map<string, NoteAsset>();
export function cacheImages(assets: NoteAsset[]): void { for (const asset of assets) images.set(asset.id, asset); }
export function hydrateImages(root: ParentNode = document): void {
  root.querySelectorAll<HTMLImageElement>("img[data-local-image]").forEach(img => {
    const asset = images.get(img.dataset.localImage!);
    if (asset) { if (img.getAttribute("src") !== asset.dataUrl) img.src = asset.dataUrl; img.width = asset.width; img.height = asset.height; }
    else { img.alt = img.alt || "本地图片暂不可用"; }
  });
}
/** Local-only bounded decode; no remote upload, and metadata is removed by canvas encoding. */
export async function prepareImage(file: File): Promise<NoteAsset> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("请选择 10 MB 以内的 PNG、JPEG 或 WebP 图片");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    if (img.naturalWidth * img.naturalHeight > 16_000_000) throw new Error("图片最多 1600 万像素，请先缩小后再插入");
    const ratio = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const context = canvas.getContext("2d"); if (!context) throw new Error("浏览器无法处理此图片");
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL("image/webp", .85);
    if (dataUrl.length > 699_050) dataUrl = canvas.toDataURL("image/webp", .6);
    if (dataUrl.length > 699_050) throw new Error("压缩后仍超过 512 KB，请选择尺寸更小的图片");
    return { id: crypto.randomUUID(), dataUrl, width: canvas.width, height: canvas.height, createdAt: new Date().toISOString() };
  } finally { URL.revokeObjectURL(url); }
}

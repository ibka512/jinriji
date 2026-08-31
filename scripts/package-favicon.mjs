// Package the pre-rendered PNG sizes without resampling or adding a dependency.
import { readFile, writeFile } from "node:fs/promises";

const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(size =>
  readFile(new URL(`../public/icons/favicon-${size}.png`, import.meta.url))));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((png, index) => {
  const size = sizes[index];
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) {
    throw new Error(`Expected a ${size}×${size} favicon`);
  }
  const entry = 6 + index * 16;
  header[entry] = size;
  header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await writeFile(new URL("../public/favicon.ico", import.meta.url), Buffer.concat([header, ...images]));
console.log("Packaged 16, 32 and 48 pixel icons in public/favicon.ico");

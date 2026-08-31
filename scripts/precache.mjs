// Atomically install the HTML and its build-specific JS/CSS before offering an update.
import { readdir, readFile, writeFile } from "node:fs/promises";

const output = new URL("../dist/", import.meta.url);
const assets = (await readdir(new URL("assets/", output)))
  .filter(name => /\.(js|css)$/.test(name))
  .sort()
  .map(name => `./assets/${name}`);
if (!assets.some(path => path.endsWith(".js")) || !assets.some(path => path.endsWith(".css"))) {
  throw new Error("Production build is missing JavaScript or CSS; refusing incomplete offline cache");
}
const worker = new URL("sw.js", output);
const source = await readFile(worker, "utf8");
const marker = "const BUILD_ASSETS = [];";
if (!source.includes(marker)) throw new Error("Service worker precache marker is missing");
await writeFile(worker, source.replace(marker, `const BUILD_ASSETS = ${JSON.stringify(assets)};`));
console.log(`Precached ${assets.length} versioned assets for offline updates`);

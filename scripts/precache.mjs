// Atomically install the HTML and its build-specific JS/CSS before offering an update.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

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
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const html = await readFile(new URL("index.html", output), "utf8");
const fingerprint = createHash("sha256").update(html).update(source).update(JSON.stringify(assets)).digest("hex").slice(0, 12);
const cacheMarker = 'const CACHE_NAME = "jinriji-development";';
const marker = "const BUILD_ASSETS = [];";
if (!source.includes(marker) || !source.includes(cacheMarker)) throw new Error("Service worker precache marker is missing");
await writeFile(worker, source.replace(marker, `const BUILD_ASSETS = ${JSON.stringify(assets)};`)
  .replace(cacheMarker, `const CACHE_NAME = ${JSON.stringify(`jinriji-${version}-${fingerprint}`)};`));
console.log(`Precached ${assets.length} versioned assets for offline updates`);

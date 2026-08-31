import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Include the exact installed license text for every production package in the release.
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const sections = [await readFile("public/third-party-notices.txt", "utf8")];
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path.startsWith("node_modules/") || meta.dev || meta.devOptional) continue;
  const files = await readdir(path);
  const licenses = files.filter(name => /^(license|licence|copying)(\.(md|txt))?$/i.test(name));
  if (!licenses.length) throw new Error(`Missing production license: ${path}`);
  sections.push(`\n${path.replace(/^node_modules\//, "")} @ ${meta.version}\n${"=".repeat(60)}\n`);
  for (const file of licenses) sections.push(await readFile(join(path, file), "utf8"));
}
await writeFile("dist/third-party-licenses.txt", sections.join("\n"));
console.log("Included production dependency licenses");

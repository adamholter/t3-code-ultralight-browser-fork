import { readFile, readdir, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

const distFiles = await filesUnder(resolve("dist"));
const libraryFiles = await filesUnder(resolve("dist-lib"));
const fontFiles = distFiles.filter((file) => [".woff", ".woff2", ".ttf", ".otf"].includes(extname(file)));
const sourceMaps = libraryFiles.filter((file) => file.endsWith(".map"));
const appJavaScript = distFiles.filter((file) => file.endsWith(".js"));
const appStyles = distFiles.filter((file) => file.endsWith(".css"));
const MAX_APP_BYTES = 260_000;
const hostedModules = [resolve("dist-lib/element-auto.js"), resolve("dist-lib/client.js")];

if (fontFiles.length) throw new Error(`Built app contains bundled fonts: ${fontFiles.join(", ")}`);
if (sourceMaps.length) throw new Error(`Published library contains source maps: ${sourceMaps.join(", ")}`);
if (appJavaScript.length !== 1 || appStyles.length !== 1) {
  throw new Error(`Expected one app script and one stylesheet; found ${appJavaScript.length} scripts and ${appStyles.length} stylesheets`);
}
for (const modulePath of hostedModules) {
  const source = await readFile(modulePath, "utf8");
  if (/^\s*import\s/m.test(source)) throw new Error(`Hosted browser module contains an unresolved import: ${modulePath}`);
}

const appBytes = (await Promise.all([...appJavaScript, ...appStyles].map(async (file) => (await stat(file)).size)))
  .reduce((total, size) => total + size, 0);
if (appBytes > MAX_APP_BYTES) throw new Error(`Standalone app is ${appBytes} bytes; budget is ${MAX_APP_BYTES}`);
console.log(JSON.stringify({ appBytes, maxAppBytes: MAX_APP_BYTES, fontFiles: 0, librarySourceMaps: 0, selfContainedHostedModules: hostedModules.length }));

async function filesUnder(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => resolve(entry.parentPath, entry.name));
}

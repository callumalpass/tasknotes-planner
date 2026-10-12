import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "..", "dist");
const index = resolve(dist, "index.html");
const callback = resolve(dist, "auth", "mdbase", "callback");

await mkdir(callback, { recursive: true });
await Promise.all([
  copyFile(index, resolve(dist, "404.html")),
  copyFile(index, resolve(callback, "index.html")),
]);
await writeFile(resolve(dist, "_redirects"), await pagesRedirects(dist));

/** Cloudflare Pages applies _redirects before static files and ignores
 * `/* /index.html 200` as a loop, so a deep route would reach 404.html with a
 * 404 status. Real files and asset directories pass through first (a missing
 * asset still gets a real 404); every other path is rewritten to the app shell. */
async function pagesRedirects(root) {
  const skip = new Set([
    "_headers",
    "_redirects",
    "_routes.json",
    "index.html",
    "404.html",
  ]);
  const rules = [];
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (/\s/.test(entry.name))
      throw new Error(`Unroutable file name in dist: ${entry.name}`);
    if (entry.isDirectory()) {
      if (!(await appShellCopiesOnly(resolve(root, entry.name))))
        rules.push(`/${entry.name}/* /${entry.name}/:splat 200`);
    } else if (!skip.has(entry.name)) {
      rules.push(`/${entry.name} /${entry.name} 200`);
    }
  }
  rules.push("/* / 200");
  return `${rules.join("\n")}\n`;
}

/** Route directories hold only copies of the app shell (for example the sign-in
 * callback); the app-shell rewrite already serves them. */
async function appShellCopiesOnly(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const ok = entry.isDirectory()
      ? await appShellCopiesOnly(resolve(directory, entry.name))
      : entry.name === "index.html";
    if (!ok) return false;
  }
  return true;
}

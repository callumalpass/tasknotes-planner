import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "..", "dist");
const index = resolve(dist, "index.html");
const callback = resolve(dist, "auth", "mdbase", "callback");

await mkdir(callback, { recursive: true });
await copyFile(index, resolve(callback, "index.html"));

/** Planner's only client route besides `/` is the sign-in callback (views are
 * query parameters). Pages applies _redirects before static files, and a
 * rewrite to `/index.html` would loop, so it points at `/`. Files are served as
 * they are; any other path gets public/404.html with a 404 status. */
await writeFile(
  resolve(dist, "_redirects"),
  "/auth/mdbase/callback / 200\n/auth/mdbase/callback/ / 200\n",
);

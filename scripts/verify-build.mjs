import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function verifyPlannerBuild({
  appOrigin,
  connectOrigin,
  loopbackOrigin,
}) {
  const root = resolve(import.meta.dirname, "..", "dist");
  const manifest = JSON.parse(
    await readFile(resolve(root, ".well-known", "mdbase-app.json"), "utf8"),
  );
  const callback = `${appOrigin}/auth/mdbase/callback`;
  if (
    manifest.homepage !== `${appOrigin}/` ||
    manifest.icon !== `${appOrigin}/tasknotes-mark.svg` ||
    manifest.redirect_uris?.length !== 1 ||
    manifest.redirect_uris[0] !== callback
  )
    throw new Error(`Planner manifest does not declare ${appOrigin}.`);

  await readFile(resolve(root, "auth", "mdbase", "callback", "index.html"));
  // Only real routes reach the app shell; unknown paths get a real 404.
  const redirects = (await readFile(resolve(root, "_redirects"), "utf8"))
    .trim()
    .split("\n");
  if (
    !redirects.includes("/auth/mdbase/callback / 200") ||
    redirects.some(
      (rule) => /^\/\*\s/.test(rule) || /\s\/index(\.html)?\b/.test(rule),
    )
  )
    throw new Error("Planner _redirects must list only real routes.");
  const notFound = await readFile(resolve(root, "404.html"), "utf8");
  if (!notFound.includes("Page not found") || notFound.includes('id="root"'))
    throw new Error("Planner 404.html must be the not-found page.");
  const scripts = (await readdir(resolve(root, "assets")))
    .filter((file) => file.endsWith(".js"))
    .map((file) => resolve(root, "assets", file));
  const sources = await Promise.all(
    scripts.map((script) => readFile(script, "utf8")),
  );
  for (const expected of [connectOrigin, loopbackOrigin])
    if (!sources.some((source) => source.includes(expected)))
      throw new Error(`Planner bundle does not contain ${expected}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await verifyPlannerBuild({
    appOrigin:
      process.env.TASKNOTES_PLANNER_URL ?? "https://planner.tasknotes.dev",
    connectOrigin:
      process.env.VITE_MDBASE_CONNECT_URL ?? "https://connect.mdbase.dev",
    loopbackOrigin:
      process.env.VITE_MDBASE_CONNECT_LOOPBACK_URL ?? "http://127.0.0.1:28485",
  });

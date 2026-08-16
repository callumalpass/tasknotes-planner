import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyPlannerBuild } from "./verify-build.mjs";

const deployment = Object.freeze({
  appOrigin: "https://staging.tasknotes-planner.pages.dev",
  connectOrigin: "https://connect-staging.mdbase.dev",
  loopbackOrigin: "http://127.0.0.1:28486",
  branch: "staging",
});
const environment = {
  ...process.env,
  TASKNOTES_PLANNER_URL: deployment.appOrigin,
  VITE_MDBASE_CONNECT_URL: deployment.connectOrigin,
  VITE_MDBASE_CONNECT_LOOPBACK_URL: deployment.loopbackOrigin,
};

await buildWithTemporaryManifest(environment, () =>
  verifyPlannerBuild(deployment),
);
await run(
  "pnpm",
  [
    "dlx",
    "wrangler@4.114.0",
    "pages",
    "deploy",
    "dist",
    "--project-name=tasknotes-planner",
    `--branch=${deployment.branch}`,
    "--commit-dirty=true",
  ],
  environment,
);
await run("node", ["scripts/production-smoke.mjs"], {
  ...environment,
  TASKNOTES_PRODUCTION_URL: deployment.appOrigin,
  MDBASE_CONNECT_ORIGIN: deployment.connectOrigin,
});
console.log(`Planner staging deployment is healthy: ${deployment.appOrigin}/`);

async function buildWithTemporaryManifest(env, verify) {
  const targets = [
    resolve("public/.well-known/mdbase-app.json"),
    resolve("src/generated-mdbase-app.json"),
  ];
  const previous = await Promise.all(targets.map((target) => readFile(target)));
  try {
    await run("pnpm", ["build"], env);
    await verify();
  } finally {
    await Promise.all(
      targets.map((target, index) =>
        previous[index] ? writeFile(target, previous[index]) : unlink(target),
      ),
    );
  }
}

async function run(command, args, env) {
  const child = spawn(command, args, {
    cwd: resolve(import.meta.dirname, ".."),
    env,
    stdio: "inherit",
  });
  const code = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) =>
      signal
        ? reject(new Error(`${command} stopped by ${signal}.`))
        : resolveExit(exitCode),
    );
  });
  if (code !== 0)
    throw new Error(`${command} ${args.join(" ")} exited with ${code}.`);
}

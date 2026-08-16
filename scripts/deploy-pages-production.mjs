import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { verifyPlannerBuild } from "./verify-build.mjs";

const deployment = Object.freeze({
  appOrigin: "https://planner.tasknotes.dev",
  connectOrigin: "https://connect.mdbase.dev",
  loopbackOrigin: "http://127.0.0.1:28485",
});
const environment = {
  ...process.env,
  TASKNOTES_PLANNER_URL: deployment.appOrigin,
  VITE_MDBASE_CONNECT_URL: deployment.connectOrigin,
  VITE_MDBASE_CONNECT_LOOPBACK_URL: deployment.loopbackOrigin,
};

await run("pnpm", ["build"], environment);
await verifyPlannerBuild(deployment);
await run(
  "pnpm",
  [
    "dlx",
    "wrangler@4.114.0",
    "pages",
    "deploy",
    "dist",
    "--project-name=tasknotes-planner",
    "--branch=main",
    "--commit-dirty=false",
  ],
  environment,
);
await run("node", ["scripts/production-smoke.mjs"], {
  ...environment,
  TASKNOTES_PRODUCTION_URL: deployment.appOrigin,
  MDBASE_CONNECT_ORIGIN: deployment.connectOrigin,
});
console.log(
  `Planner production deployment is healthy: ${deployment.appOrigin}/`,
);

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

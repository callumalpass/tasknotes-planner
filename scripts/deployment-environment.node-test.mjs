import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { plannerDeploymentFor } from "./deployment-environment.mjs";
test("Planner LAB is an explicit fixed target; prior staging default is unchanged", () => {
  assert.deepEqual(plannerDeploymentFor({ MDBASE_ENV: "lab" }), {
    appOrigin: "https://lab.tasknotes-planner.pages.dev",
    connectOrigin: "https://connect-lab.mdbase.dev",
    loopbackOrigin: "http://127.0.0.1:28487",
    branch: "lab",
  });
  assert.equal(plannerDeploymentFor({}).branch, "staging");
  assert.equal(
    plannerDeploymentFor({ MDBASE_ENV: "staging" }).connectOrigin,
    "https://connect-staging.mdbase.dev",
  );
  for (const MDBASE_ENV of ["production", "unknown", ""])
    assert.throws(() => plannerDeploymentFor({ MDBASE_ENV }));
});
test("deploy:lab uses the same guarded front door with a fixed LAB selector", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    pkg.scripts["deploy:lab"],
    "MDBASE_ENV=lab node scripts/deploy-pages-dev.mjs",
  );
});

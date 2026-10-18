const deployments = Object.freeze({
  staging: Object.freeze({
    appOrigin: "https://staging.tasknotes-planner.pages.dev",
    connectOrigin: "https://connect-staging.mdbase.dev",
    loopbackOrigin: "http://127.0.0.1:28486",
    branch: "staging",
  }),
  lab: Object.freeze({
    appOrigin: "https://lab.tasknotes-planner.pages.dev",
    connectOrigin: "https://connect-lab.mdbase.dev",
    loopbackOrigin: "http://127.0.0.1:28487",
    branch: "lab",
  }),
});
/** Preserve the existing staging default; LAB requires the literal selector. */
export function plannerDeploymentFor(environment) {
  const target = environment.MDBASE_ENV ?? "staging";
  if (!Object.hasOwn(deployments, target))
    throw new Error("Unsupported Planner development deployment target.");
  return deployments[target];
}

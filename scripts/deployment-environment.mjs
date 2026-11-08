const deployments = Object.freeze({
  staging: Object.freeze({
    appOrigin: "https://staging.tasknotes-planner.pages.dev",
    connectOrigin: "https://connect-staging.mdbase.dev",
    branch: "staging",
  }),
  lab: Object.freeze({
    appOrigin: "https://lab.tasknotes-planner.pages.dev",
    connectOrigin: "https://connect-lab.mdbase.dev",
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

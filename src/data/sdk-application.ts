import {
  MdbaseConnect,
  type MdbaseApplicationDeclaration,
  type MdbaseApplicationEntry,
} from "@mdbase-dev/sdk";
import manifest from "../generated-mdbase-app.json";

/** Declaration only: the unchanged canonical manifest (logical ID, name, homepage
 * origin) and the deployment environment. The SDK registers the manifest and
 * rebinds to the actual registered application ID before any storage; no Planner
 * storage overrides or app-owned native plumbing. Construction performs no IO. */
export function createPlannerApplication({
  environment,
}: {
  environment: MdbaseApplicationDeclaration["environment"];
}): MdbaseConnect {
  return new MdbaseConnect({
    id: manifest.id,
    name: manifest.name,
    origin: new URL(manifest.homepage).origin,
    environment,
    manifest,
  });
}

let entry: MdbaseApplicationEntry | null = null;

/** The one public SDK entry for this page (LAB builds only, see main.tsx). It is
 * never closed by the UI; registration, Worker and storage start lazily. */
export function plannerSdk(): MdbaseApplicationEntry {
  entry ??= createPlannerApplication({ environment: "lab" });
  return entry;
}

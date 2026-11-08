import {
  createMdbase,
  type Mdbase,
  type MdbaseApplicationDeclaration,
} from "@mdbase-dev/sdk";
import manifest from "../generated-mdbase-app.json";

type PlannerEnvironment = MdbaseApplicationDeclaration["environment"];

/** The build's mdbase environment. Unset builds are production; LAB and
 * staging deployments set `VITE_MDBASE_ENV` explicitly. */
export function plannerEnvironment(
  configured: string | undefined = import.meta.env.VITE_MDBASE_ENV,
): Exclude<PlannerEnvironment, "local"> {
  if (!configured) return "production";
  if (configured === "lab" || configured === "staging") return configured;
  throw new Error(`Unsupported VITE_MDBASE_ENV: ${configured}`);
}

/** Declaration only: the unchanged canonical manifest (logical ID, name, homepage
 * origin) and the deployment environment. The SDK registers the manifest and
 * rebinds to the actual registered application ID before any storage. */
export function plannerDeclaration(
  environment: PlannerEnvironment,
): MdbaseApplicationDeclaration {
  return {
    id: manifest.id,
    name: manifest.name,
    origin: new URL(manifest.homepage).origin,
    environment,
    manifest,
  };
}

let entry: Mdbase | null = null;

/** The page's one SDK entry. Construction performs no IO; the SDK follows
 * page visibility itself. */
export function plannerMdbase(): Mdbase {
  entry ??= createMdbase(plannerDeclaration(plannerEnvironment()), {
    followVisibility: true,
  });
  return entry;
}

import {
  MdbaseConnect,
  type MdbaseApplicationDeclaration,
} from "@mdbase-dev/sdk";
import manifest from "../generated-mdbase-app.json";

/** Declaration only. The caller must supply the actual registered native ID;
 * neither the logical manifest ID nor the frozen prototype UUID is a binding.
 * SDK registration/validation MUST settle it before storage is allocated.
 * No Planner storage compatibility overrides or app-owned native plumbing. */
export function createPlannerApplication({
  registeredApplicationId,
  environment,
}: {
  registeredApplicationId: string;
  environment: MdbaseApplicationDeclaration["environment"];
}) {
  return new MdbaseConnect({
    id: registeredApplicationId,
    name: manifest.name,
    origin: new URL(manifest.homepage).origin,
    environment,
    manifest,
  });
}

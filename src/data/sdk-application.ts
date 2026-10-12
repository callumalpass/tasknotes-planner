import {
  createMdbase,
  type Mdbase,
  type MdbaseApplicationDeclaration,
} from "@mdbase-dev/sdk";
import manifest from "../generated-mdbase-app.json";

/** Declaration only: the unchanged canonical manifest (logical ID, name, homepage
 * origin) and the deployment environment. The SDK registers the manifest and
 * rebinds to the actual registered application ID before any storage. */
export function plannerDeclaration(
  environment: MdbaseApplicationDeclaration["environment"],
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

/** The page's one SDK entry (LAB builds only, see root.tsx). Construction
 * performs no IO. No followVisibility: this SDK cut calls it before the entry
 * exists; foreground defaults to on. */
export function plannerMdbase(): Mdbase {
  entry ??= createMdbase(plannerDeclaration("lab"));
  return entry;
}

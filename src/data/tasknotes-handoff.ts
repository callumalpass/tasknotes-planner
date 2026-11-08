import { mdbaseAppHref } from "@mdbase-dev/ui/apps";

import { plannerEnvironment } from "./sdk-application";

const taskNotesOrigins = {
  lab: "https://lab.tasknotes-app.pages.dev",
  staging: "https://staging.tasknotes-app.pages.dev",
  production: "https://app.tasknotes.dev",
} as const;

/** Open the loaded collection, not a stale URL selection or a demo/view URL.
 * TaskNotes still owns its own sign-in, approval and task creation. */
export function taskNotesHref(collectionId: string): string {
  return mdbaseAppHref(
    taskNotesOrigins[plannerEnvironment()],
    `${location.origin}/?collection=${encodeURIComponent(collectionId)}`,
  );
}

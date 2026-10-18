import { mdbaseAppHref } from "@mdbase-dev/ui/apps";

/** Open the loaded collection, not a stale URL selection or a demo/view URL.
 * TaskNotes still owns its own sign-in, approval and task creation. */
export function taskNotesHref(collectionId: string): string {
  const origin =
    import.meta.env.VITE_MDBASE_ENV === "lab"
      ? "https://lab.tasknotes-app.pages.dev"
      : import.meta.env.VITE_MDBASE_CONNECT_URL ===
          "https://connect-staging.mdbase.dev"
        ? "https://staging.tasknotes-app.pages.dev"
        : "https://app.tasknotes.dev";
  return mdbaseAppHref(
    origin,
    `${location.origin}/?collection=${encodeURIComponent(collectionId)}`,
  );
}

import {
  MdbaseBrowserSelection,
  MdbaseConnect,
  type JsonObject,
  type MdbaseAppManifest,
} from "@mdbase-dev/connect";

import manifest from "../generated-mdbase-app.json";

const serverUrl =
  import.meta.env.VITE_MDBASE_CONNECT_URL ?? "https://connect.mdbase.dev";
const loopbackUrl =
  import.meta.env.VITE_MDBASE_CONNECT_LOOPBACK_URL ?? "http://127.0.0.1:28485";
const redirectUri = `${location.origin}${joinBase("auth/mdbase/callback")}`;

const connect = new MdbaseConnect<JsonObject>({
  serverUrl,
  loopbackUrl,
  manifest: manifest as MdbaseAppManifest,
  redirectUri,
  relayEncryption: "required",
});

export const plannerSession = connect.application({
  selection: new MdbaseBrowserSelection({ fallbackPath: joinBase("") }),
  autoSelect: "never",
});

export function isAuthorizationCallback(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.searchParams.has("state") &&
      (url.searchParams.has("code") || url.searchParams.has("error"))
    );
  } catch {
    return false;
  }
}

function joinBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}

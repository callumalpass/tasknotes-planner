import { plannerSdk } from "../data/sdk-application";
import { App } from "./app";

/** Planner over the page's one public SDK entry (LAB builds; see main.tsx). */
export default function SdkApp() {
  return <App sdk={plannerSdk()} />;
}

import { lazy, Suspense } from "react";
import { App } from "./app";

// LAB builds open collections through the public SDK entry, loaded only there.
// Other builds keep Connect: the SDK has no production release trust yet.
const SdkApp = lazy(() => import("./sdk-app"));

export function Root() {
  return import.meta.env.VITE_MDBASE_ENV === "lab" ? (
    <Suspense fallback={null}>
      <SdkApp />
    </Suspense>
  ) : (
    <App />
  );
}

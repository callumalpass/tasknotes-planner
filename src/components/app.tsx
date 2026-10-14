import { lazy, Suspense } from "react";

import { DemoPlannerRepository } from "../data/demo-repository";
import { Planner } from "./planner";
import { useSampleMode } from "./use-sample-mode";

// Native mode must not instantiate the legacy Connect session or selection.
const ConnectionGate = lazy(async () => {
  const module = await import("./connection-gate");
  return { default: module.ConnectionGate };
});

/** Planner over legacy Connect (non-LAB builds). LAB builds use `SdkApp`. */
export function App() {
  const { demo, enter, leave } = useSampleMode();
  return demo ? (
    <Planner
      repository={new DemoPlannerRepository()}
      onChangeCollection={leave}
    />
  ) : (
    <Suspense
      fallback={
        <main className="welcome">
          <p role="status">Opening Planner…</p>
        </main>
      }
    >
      <ConnectionGate onDemo={enter} />
    </Suspense>
  );
}

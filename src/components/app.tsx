import { lazy, Suspense, useState } from "react";

import { DemoPlannerRepository } from "../data/demo-repository";
import { Planner } from "./planner";
import { SdkConnectionGate, type PlannerSdk } from "./sdk-connection-gate";

// Native mode must not instantiate the legacy Connect session or selection.
const ConnectionGate = lazy(async () => {
  const module = await import("./connection-gate");
  return { default: module.ConnectionGate };
});

export function App({
  sdk,
  onSignedOut,
}: { sdk?: PlannerSdk; onSignedOut?(): void } = {}) {
  const [demo, setDemo] = useState(
    () => new URL(location.href).searchParams.get("demo") === "1",
  );
  const leaveDemo = () => {
    const url = new URL(location.href);
    url.searchParams.delete("demo");
    history.replaceState(history.state, "", url);
    setDemo(false);
  };
  return demo ? (
    <Planner
      repository={new DemoPlannerRepository()}
      onChangeCollection={leaveDemo}
    />
  ) : sdk ? (
    <SdkConnectionGate
      sdk={sdk}
      onDemo={() => setDemo(true)}
      onSignedOut={onSignedOut}
    />
  ) : (
    <Suspense
      fallback={
        <main className="welcome">
          <p role="status">Opening Planner…</p>
        </main>
      }
    >
      <ConnectionGate onDemo={() => setDemo(true)} />
    </Suspense>
  );
}

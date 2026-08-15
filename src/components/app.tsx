import { useState } from "react";

import { DemoPlannerRepository } from "../data/demo-repository";
import { ConnectionGate } from "./connection-gate";
import { Planner } from "./planner";

export function App() {
  const [demo, setDemo] = useState(
    () => new URL(location.href).searchParams.get("demo") === "1",
  );
  return demo ? (
    <Planner
      repository={new DemoPlannerRepository()}
      onChangeCollection={() => setDemo(false)}
    />
  ) : (
    <ConnectionGate onDemo={() => setDemo(true)} />
  );
}

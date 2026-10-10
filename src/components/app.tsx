import { useState } from "react";

import { DemoPlannerRepository } from "../data/demo-repository";
import { ConnectionGate } from "./connection-gate";
import { Planner } from "./planner";

export function App() {
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
  ) : (
    <ConnectionGate onDemo={() => setDemo(true)} />
  );
}

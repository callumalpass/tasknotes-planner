import { useState } from "react";

/** Sample tasks, entered from the first-run screen or a `?demo=1` link. Leaving
 * removes only the `demo` parameter and keeps other URL state. */
export function useSampleMode() {
  const [demo, setDemo] = useState(
    () => new URL(location.href).searchParams.get("demo") === "1",
  );
  const leave = () => {
    const url = new URL(location.href);
    url.searchParams.delete("demo");
    history.replaceState(history.state, "", url);
    setDemo(false);
  };
  return { demo, enter: () => setDemo(true), leave };
}

import { useState } from "react";

/** Keep immediate edits until the authoritative value actually changes. */
export function useConfirmedDraft<T>(
  confirmed: T,
  equal: (left: T, right: T) => boolean = Object.is,
): [T, (draft: T) => void, () => void] {
  const [state, setState] = useState({ confirmed, draft: confirmed });
  const changed = !equal(state.confirmed, confirmed);
  // Reconcile during render, not after paint: the control and its header must
  // show the same confirmed value without resetting unrelated form drafts.
  if (changed) setState({ confirmed, draft: confirmed });
  return [
    changed ? confirmed : state.draft,
    (draft) => setState((current) => ({ ...current, draft })),
    () => setState((current) => ({ ...current, draft: current.confirmed })),
  ];
}

import { useEffect, useRef, type RefObject } from "react";

const focusableSelector =
  'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]';

function focusableWithin(root: HTMLElement): HTMLElement[] {
  // Some selector engines do not return grouped selectors in document order.
  return [...root.querySelectorAll<HTMLElement>(focusableSelector)]
    .filter(
      (element) =>
        element.tabIndex >= 0 && !element.closest("[hidden], [inert]"),
    )
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1,
    );
}

/**
 * Keeps keyboard focus inside an open modal dialog, dismisses it on Escape,
 * and returns focus to the control that opened it once it closes. Mark the
 * initial control with `data-autofocus` rather than `autoFocus`, which would
 * move focus before the opener is recorded.
 */
export function useModalFocus(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = rootRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      const initial =
        dialog.querySelector<HTMLElement>("[data-autofocus]") ??
        focusableWithin(dialog)[0];
      initial?.focus();
    }

    function keydown(event: KeyboardEvent) {
      const root = rootRef.current;
      if (!root || event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableWithin(root);
      const first = elements[0];
      const last = elements.at(-1);
      const active = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (
        !elements.includes(active as HTMLElement) ||
        (event.shiftKey ? active === first : active === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }

    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [open, rootRef]);
}

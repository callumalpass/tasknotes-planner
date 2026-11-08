import { describeError } from "@mdbase-dev/sdk";

export function isOperationOutcomeUnknown(reason: unknown): boolean {
  return describeError(reason)?.code === "outcome_unknown";
}

/** Person-facing copy. Coded mdbase problems use the SDK's copy and keep their
 * technical text in the console; the app's own errors keep their message. */
export function errorMessage(reason: unknown): string {
  const description = describeError(reason);
  // Codes without SDK copy keep the problem's own message.
  if (description && description.key !== "unknown") {
    console.warn(
      "mdbase problem:",
      description.code,
      description.developerMessage ?? "",
      reason instanceof Error ? reason.message : "",
    );
    return description.message;
  }
  return reason instanceof Error ? reason.message : String(reason);
}

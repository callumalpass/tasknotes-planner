import {
  MdbaseConnectError,
  type ConnectOutcome,
  type ConnectProblemCode,
} from "@mdbase-dev/connect";
import { describeError } from "@mdbase-dev/sdk";

export function requireOutcome<Value, Code extends ConnectProblemCode>(
  outcome: ConnectOutcome<Value, Code>,
): Value {
  if (!outcome.ok) throw new MdbaseConnectError(outcome.problem);
  return outcome.value;
}

export function isOperationOutcomeUnknown(reason: unknown): boolean {
  return (
    reason instanceof MdbaseConnectError &&
    reason.problem.operation_outcome === "unknown"
  );
}

/** Person-facing copy. Coded mdbase problems use the SDK's copy and keep their
 * technical text in the console; the app's own errors keep their message. */
export function errorMessage(reason: unknown): string {
  const description = describeError(reason);
  // Codes without SDK copy keep the problem's own message (Connect problems carry one).
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

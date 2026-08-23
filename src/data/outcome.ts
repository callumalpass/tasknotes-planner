import {
  MdbaseConnectError,
  type ConnectOutcome,
  type ConnectProblemCode,
} from "@mdbase-dev/connect";

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

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

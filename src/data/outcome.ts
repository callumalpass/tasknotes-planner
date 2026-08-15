import type { ConnectOutcome, ConnectProblemCode } from "@mdbase-dev/connect";

export function requireOutcome<Value, Code extends ConnectProblemCode>(
  outcome: ConnectOutcome<Value, Code>,
): Value {
  if (!outcome.ok) throw new Error(outcome.problem.message);
  return outcome.value;
}

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

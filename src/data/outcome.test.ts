import {
  MdbaseConnectError,
  type ConnectOutcome,
  type ConnectProblem,
} from "@mdbase-dev/connect";

import { isOperationOutcomeUnknown, requireOutcome } from "./outcome";

describe("Connect outcomes", () => {
  it("preserves structured unknown mutation outcomes", () => {
    const problem = {
      problem_version: 1,
      code: "operation_outcome_unknown",
      category: "transport",
      recovery: "recover_mutation",
      message: "The task update may already have completed.",
      operation_outcome: "unknown",
      details: { request_id: "request-1" },
    } as unknown as ConnectProblem;
    const outcome = {
      ok: false,
      problem,
    } as ConnectOutcome<never>;

    let thrown: unknown;
    try {
      requireOutcome(outcome);
    } catch (reason) {
      thrown = reason;
    }

    expect(thrown).toBeInstanceOf(MdbaseConnectError);
    expect((thrown as MdbaseConnectError).problem).toBe(problem);
    expect(isOperationOutcomeUnknown(thrown)).toBe(true);
  });
});

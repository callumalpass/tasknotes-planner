import { MdbaseError } from "@mdbase-dev/sdk";

import { errorMessage, isOperationOutcomeUnknown } from "./outcome";

describe("mdbase outcomes", () => {
  it("recognises unknown write outcomes", () => {
    expect(
      isOperationOutcomeUnknown(
        new MdbaseError({
          code: "outcome_unknown",
          recovery: "refresh",
          message: "The task update may already have completed.",
        }),
      ),
    ).toBe(true);
    expect(isOperationOutcomeUnknown(new Error("Title is required"))).toBe(
      false,
    );
  });

  it("shows person-facing copy, not replica text, for coded mdbase problems", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reason = Object.assign(
      new Error("complete bounded raw record inventory is unavailable"),
      { code: "unavailable", reason: "view_metadata_unavailable" },
    );
    const message = errorMessage(reason);
    expect(message).not.toContain("inventory");
    expect(message.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
    expect(errorMessage(new Error("Title is required"))).toBe(
      "Title is required",
    );
    warn.mockRestore();
  });
});

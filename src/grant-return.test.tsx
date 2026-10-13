import { render, screen } from "@testing-library/react";

const sdk = vi.hoisted(() => ({ plannerMdbase: vi.fn() }));
vi.mock("./data/sdk-application", () => ({
  plannerMdbase: sdk.plannerMdbase,
}));
vi.mock("./components/root", () => ({
  Root: () => {
    sdk.plannerMdbase();
    return <p>planner</p>;
  },
}));

import {
  deliverAppGrantReturn,
  isAppGrantCallback,
  pageFor,
} from "./grant-return";

const callback = "http://127.0.0.1:48221/auth/mdbase/callback?state=s1&code=c1";

describe("Private collection consent popup return", () => {
  it("recognizes a consent return by state with code or error", () => {
    expect(isAppGrantCallback(callback)).toBe(true);
    expect(
      isAppGrantCallback(
        "http://127.0.0.1:48221/auth/mdbase/callback?state=s1&error=access_denied",
      ),
    ).toBe(true);
    expect(isAppGrantCallback("http://127.0.0.1:48221/?collection=x")).toBe(
      false,
    );
    expect(isAppGrantCallback("http://127.0.0.1:48221/?code=c1")).toBe(false);
  });

  it("delivers the return URL through the SDK's grant callback", async () => {
    const deliverAppGrantCallback = vi.fn();
    await deliverAppGrantReturn(callback, async () => ({
      deliverAppGrantCallback,
    }));
    expect(deliverAppGrantCallback).toHaveBeenCalledWith(callback);
  });

  it("in LAB, delivers and closes without starting the SDK entry", async () => {
    const deliver = vi.fn(async () => {});
    const close = vi.fn();
    render(<>{pageFor(callback, "lab", close, deliver)}</>);
    expect(screen.getByText("You can close this window.")).toBeTruthy();
    expect(deliver).toHaveBeenCalledWith(callback);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(sdk.plannerMdbase).not.toHaveBeenCalled();
  });

  it("renders the app for any other page, and leaves Connect's callback to Connect", () => {
    const deliver = vi.fn(async () => {});
    render(
      <>
        {pageFor("http://127.0.0.1:48221/", "lab", vi.fn(), deliver)}
        {pageFor(callback, "production", vi.fn(), deliver)}
      </>,
    );
    expect(screen.getAllByText("planner")).toHaveLength(2);
    expect(deliver).not.toHaveBeenCalled();
  });
});

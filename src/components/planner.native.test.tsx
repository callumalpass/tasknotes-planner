import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MdbaseClient } from "@mdbase-dev/sdk";
import { nativePlannerFixture } from "../test/native-planner-fixture";
import { NextPlannerRepository } from "../data/next-planner-repository";
import { Planner } from "./planner";

const clients: MdbaseClient[] = [];
const repositories: NextPlannerRepository[] = [];
const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  for (const repository of repositories.splice(0)) repository.dispose();
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollTo)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

async function nativeFixture() {
  const f = await nativePlannerFixture();
  clients.push(f.client);
  const repository = new NextPlannerRepository(
    f.client,
    "Native test collection",
  );
  repositories.push(repository);
  return { ...f, repository };
}

describe("Planner native client surface (SDK testing fake, not native acceptance)", () => {
  it("renders the native repository in the existing ledger without a legacy session", async () => {
    const { client, repository } = await nativeFixture();
    const get = vi.spyOn(client, "get");
    const close = vi.spyOn(client, "close");
    const changeCollection = vi.fn();
    const view = render(
      <Planner repository={repository} onChangeCollection={changeCollection} />,
    );
    await waitFor(() =>
      expect(screen.getAllByText("Plan the SDK port").length).toBeGreaterThan(
        0,
      ),
    );
    expect(
      screen.getByRole("button", { name: /Native test collection/ }),
    ).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    view.unmount();
    repository.dispose();
    expect(close).not.toHaveBeenCalled();
  });

  it("shows an exact-contract refusal instead of an empty or ready planning ledger", async () => {
    const { client, repository, catalog } = await nativeFixture();
    vi.mocked(client.describe).mockResolvedValue({ ...catalog, contracts: [] });
    render(<Planner repository={repository} onChangeCollection={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/does not provide tasknotes.task/)).toBeTruthy(),
    );
    expect(screen.queryByText("Plan the SDK port")).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  MdbaseApplicationSession,
  MdbaseMemorySelection,
} from "@mdbase-dev/connect";
import {
  capabilityOperationsForContractVersion,
  APPLICATION_SETUP_OPERATIONS,
} from "@mdbase-dev/connect-protocol";
import { buildPlannerManifest } from "./planner-manifest.mjs";

const ok = (value) => ({ ok: true, value, diagnostics: [] });
const denied = (code) => ({
  ok: false,
  problem: { code, message: code },
  diagnostics: [],
});

// Only the transport boundary is a fixture: lifecycle, setup checks, exact-contract
// verification and capability evaluation all execute the installed SDK.
async function fixture({
  stale = false,
  contracts,
  setupProblem,
  describeProblem,
} = {}) {
  const manifest = await buildPlannerManifest({
    appUrl: "https://planner.tasknotes.dev",
  });
  const operations = [
    ...new Set([
      ...manifest.requirements.capabilities.required.flatMap((id) =>
        capabilityOperationsForContractVersion(2, id),
      ),
      ...APPLICATION_SETUP_OPERATIONS,
    ]),
  ];
  const info = {
    collectionId: "fixture",
    displayName: "Fixture",
    operations,
    scope: { access: "full_collection", contracts: [] },
    authority: { kind: "connector", durability: "computer" },
    route: "relay",
    directAccess: "unavailable",
  };
  const connection = {
    collectionId: info.collectionId,
    info: () => info,
    onConnectionChange: () => () => {},
    authorizationCapabilities: (required) => ({
      authorized: true,
      sufficient: required.every((op) => operations.includes(op)),
      grantedOperations: operations,
      missingOperations: required.filter((op) => !operations.includes(op)),
    }),
    assessCollectionSetup: vi.fn(async () =>
      setupProblem
        ? denied(setupProblem)
        : ok({
            status: "current",
            applicable: true,
            configuration: [],
            typePacks: [],
          }),
    ),
    applyCollectionSetup: vi.fn(),
    describe: vi.fn(async () =>
      describeProblem
        ? denied(describeProblem)
        : ok({
            collectionId: info.collectionId,
            contracts: contracts ?? manifest.requirements.contracts,
          }),
    ),
  };
  const transport = {
    register: async () =>
      ok({
        id: "v2-registration",
        family_identity: `bundle:${manifest.id}`,
        manifest_digest: "a".repeat(64),
      }),
    manifest: async () => ok(manifest),
    connections: () => [info],
    connection: () => connection,
    connectionApplicationId: () =>
      stale ? "old-v1-registration" : "v2-registration",
    onConnectionsChange: () => () => {},
    unavailableReason: () => null,
    authorize: vi.fn(async () => denied("access_denied")),
  };
  const selection = new MdbaseMemorySelection();
  selection.select(info.collectionId);
  const session = new MdbaseApplicationSession(transport, {
    selection,
    autoSelect: "never",
  });
  return { session, connection, transport };
}

describe("installed beta95 Planner session", () => {
  it("requires explicit consent for a stale registration even with sufficient operations", async () => {
    const { session, connection, transport } = await fixture({ stale: true });
    try {
      expect((await session.start()).ok).toBe(true);
      expect(session.getSnapshot().status).toBe("authorization_required");
      expect(transport.authorize).not.toHaveBeenCalled();
      expect(connection.assessCollectionSetup).not.toHaveBeenCalled();
      expect((await session.authorize("selected")).ok).toBe(false);
      expect(transport.authorize).toHaveBeenCalledTimes(1);
      expect(transport.authorize.mock.calls[0][0].target).toEqual({
        kind: "collection",
        collectionId: "fixture",
      });
      expect(session.getSnapshot().status).toBe("authorization_required");
      expect(connection.applyCollectionSetup).not.toHaveBeenCalled();
    } finally {
      session.destroy();
    }
  });

  it.each([
    [{}, "ready"],
    [{ contracts: [] }, "blocked"],
    [
      { setupProblem: "application_declaration_mismatch" },
      "authorization_required",
    ],
    [{ describeProblem: "access_denied" }, "authorization_required"],
  ])(
    "checks exact contracts and setup before ready: %j",
    async (options, status) => {
      const { session, connection } = await fixture(options);
      try {
        expect((await session.start()).ok).toBe(true);
        expect(session.getSnapshot().status).toBe(status);
        expect(connection.assessCollectionSetup).toHaveBeenCalledTimes(1);
        expect(connection.applyCollectionSetup).not.toHaveBeenCalled();
        if (!options.setupProblem)
          expect(connection.describe).toHaveBeenCalledTimes(1);
        if (status === "ready")
          expect(session.getSnapshot().readiness.contracts.state).toBe(
            "verified",
          );
      } finally {
        session.destroy();
      }
    },
  );
});

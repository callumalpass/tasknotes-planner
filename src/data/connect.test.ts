import {
  effectiveCapabilities,
  type MdbaseConnectionInfo,
  type MdbaseOperation,
} from "@mdbase-dev/connect";
import { capabilityOperationsForContractVersion } from "@mdbase-dev/connect-protocol";
import manifest from "../generated-mdbase-app.json";
import {
  assertPlannerOrigin,
  connect,
  isAuthorizationCallback,
  plannerSession,
} from "./connect";

// Real installed beta95 SDK, not a mocked constructor or capability evaluator.
describe("Planner's installed Connect runtime", () => {
  it("constructs the application session and loads the exact v2 declaration without network", async () => {
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected network"));
    const result = await connect.manifest();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.problem.message);
    expect(result.value.requirements?.capabilities).toEqual(
      manifest.requirements.capabilities,
    );
    expect(plannerSession.getSnapshot().status).toBe("not_started");
    expect(network).not.toHaveBeenCalled();
  });

  it("evaluates genuine v2 groups, rejects stale v1 operations, and grants no excluded operations", async () => {
    const result = await connect.manifest();
    if (!result.ok) throw new Error(result.problem.message);
    const declaration = result.value;
    const requirements = declaration.requirements!.capabilities!;
    const operations = [
      ...new Set(
        requirements.required.flatMap(
          (id) => capabilityOperationsForContractVersion(2, id) ?? [],
        ),
      ),
    ];
    const info: MdbaseConnectionInfo = {
      collectionId: "fixture",
      displayName: "Fixture",
      operations,
      scope: { access: "full_collection", contracts: [] },
      authority: { kind: "connector", durability: "computer" },
      route: "relay",
      directAccess: "unavailable",
    };
    const effective = effectiveCapabilities(requirements, declaration, info);
    expect(effective.contractVersion).toBe(2);
    expect(effective.requiredAvailable).toBe(true);
    expect(Object.keys(effective.values)).toEqual(
      manifest.requirements.capabilities.required,
    );
    expect(operations).not.toContain("create");
    expect(operations).not.toContain("delete");
    expect(operations.some((op) => /file|timer|sync/i.test(op))).toBe(false);
    // Prior Planner grant's exact operation union is not authority for whole v2 groups.
    const legacy: MdbaseOperation[] = [
      "describe",
      "assess_collection_setup",
      "apply_collection_setup",
      "update_type",
      "assess_type_pack",
      "apply_type_pack",
      "changes",
      "read",
      "query",
      "update",
      "list_views",
      "execute_view",
      "read_view_source",
      "create_view_source",
      "update_view_source",
    ];
    const stale = effectiveCapabilities(requirements, declaration, {
      ...info,
      operations: legacy,
    });
    expect(stale.requiredAvailable).toBe(false);
    expect(stale.values["records.edit"]?.state).toBe("requires_authorization");
    expect(stale.values["views.manage"]?.state).toBe("requires_authorization");
    const denied = effectiveCapabilities(requirements, declaration, {
      ...info,
      operations: [],
    });
    expect(denied.requiredAvailable).toBe(false);
    expect(
      Object.values(denied.values).every(
        (value) => value.state === "requires_authorization",
      ),
    ).toBe(true);
  });

  it("requires the manifest origin instead of silently accepting a localhost alias", () => {
    expect(() => assertPlannerOrigin(manifest.homepage)).not.toThrow();
    expect(() => assertPlannerOrigin("http://localhost:4174/")).toThrow(
      /Open Planner at/,
    );
    expect(
      isAuthorizationCallback(
        `${manifest.redirect_uris[0]}?state=fixture&error=access_denied`,
      ),
    ).toBe(true);
  });
});

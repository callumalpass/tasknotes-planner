import { useEffect, useMemo, useRef, useState } from "react";
import type { Mdbase, MdbaseApplicationConnection } from "@mdbase-dev/sdk";
import {
  CollectionGate,
  CollectionSwitcher,
  type CollectionUiOptions,
} from "@mdbase-dev/ui/collections";
import "@mdbase-dev/ui/collections.css";

import { DemoPlannerRepository } from "../data/demo-repository";
import { NextPlannerRepository } from "../data/next-planner-repository";
import { plannerMdbase } from "../data/sdk-application";
import { useConnectionNotice } from "./connection-notice";
import { Planner } from "./planner";
import { useSampleMode } from "./use-sample-mode";

const app = {
  name: "TaskNotes Planner",
  mark: <img alt="" src="/tasknotes-mark.svg" />,
};

/** Planner over the page's one SDK entry (LAB builds; see root.tsx). The
 * shared collection UI owns sign-in, the collection list, setup and problems,
 * and starts the entry (never closed here: it is the page's singleton). */
export default function SdkApp({ mdbase: supplied }: { mdbase?: Mdbase } = {}) {
  const [mdbase] = useState(() => supplied ?? plannerMdbase());
  const { demo, enter, leave } = useSampleMode();
  const ui = useMemo<CollectionUiOptions>(() => ({ mdbase, app }), [mdbase]);
  if (demo)
    return (
      <Planner
        repository={new DemoPlannerRepository()}
        onChangeCollection={leave}
      />
    );
  return (
    <CollectionGate
      {...ui}
      extraActions={(view) =>
        view.kind === "signed_out" ? (
          <button className="text-action" type="button" onClick={enter}>
            Try sample tasks
          </button>
        ) : null
      }
    >
      {(connection) => (
        <ReadyPlanner
          key={connection.generation}
          connection={connection}
          ui={ui}
        />
      )}
    </CollectionGate>
  );
}

/** One repository per collection generation; re-checks keep the workspace. */
function ReadyPlanner({
  connection,
  ui,
}: {
  connection: MdbaseApplicationConnection;
  ui: CollectionUiOptions;
}) {
  const [repository] = useState(
    () => new NextPlannerRepository(connection.records, connection.displayName),
  );
  const lifetime = useRef({ mounts: 0 });
  useEffect(() => {
    const current = lifetime.current;
    current.mounts++;
    return () => {
      current.mounts--;
      // Disposed on a real unmount, not on StrictMode effect replay.
      queueMicrotask(() => {
        if (!current.mounts) repository.dispose();
      });
    };
  }, [repository]);
  const { mdbase } = ui;
  const connectionNotice = useConnectionNotice(mdbase);
  return (
    <Planner
      connectionNotice={connectionNotice}
      repository={repository}
      onChangeCollection={async () => {
        await mdbase.chooseAnother();
      }}
      collectionSwitcher={
        <CollectionSwitcher
          {...ui}
          className="planner-collection-switcher"
          variant="compact"
        />
      }
    />
  );
}

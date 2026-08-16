import {
  CalendarDays,
  BookmarkPlus,
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  Moon,
  RefreshCw,
  Search,
  Sun,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  clampZoom,
  projectLabel,
  TIMELINE_ZOOMS,
  taskSpan,
  withSchedule,
  zoomDefinition,
  type TimelineZoom,
} from "../domain/gantt";
import { GanttChart } from "./gantt-chart";
import { TaskInspector } from "./task-inspector";
import { errorMessage } from "../data/outcome";

import type {
  PlannerCollection,
  PlannerRepository,
  PlannerTask,
  ScheduleUpdate,
  TaskDependency,
  TaskPropertyUpdate,
} from "../domain/task";

export function Planner({
  repository,
  onChangeCollection,
}: {
  repository: PlannerRepository;
  onChangeCollection(): void;
}) {
  const [collection, setCollection] = useState<PlannerCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [showCompleted, setShowCompleted] = useState(false);
  const [zoom, setZoom] = useState<TimelineZoom>(3);
  const [activeViewKey, setActiveViewKey] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("view"),
  );
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savingView, setSavingView] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [todayRequest, setTodayRequest] = useState(0);
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const next = await repository.load(activeViewKey ?? undefined);
        setCollection(next);
        const options = next.activeView?.options;
        setProject(options?.project ?? "all");
        setStatus(options?.status ?? "all");
        setPriority(options?.priority ?? "all");
        setShowCompleted(options?.showCompleted ?? false);
        if (options?.zoom !== undefined)
          setZoom(clampZoom(Math.round(options.zoom)));
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeViewKey, repository],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    if (!repository.watch) return;
    let dispose: (() => void) | undefined;
    void repository
      .watch(() => {
        if (refreshTimer.current !== null)
          window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => void load(true), 350);
      })
      .then((stop) => {
        dispose = stop;
      })
      .catch(() => undefined);
    return () => {
      dispose?.();
      if (refreshTimer.current !== null)
        window.clearTimeout(refreshTimer.current);
    };
  }, [load, repository]);

  const projects = useMemo(
    () =>
      [...new Set(collection?.tasks.flatMap((task) => task.projects) ?? [])]
        .map((value) => ({ value, label: projectLabel(value) }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [collection],
  );
  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (collection?.tasks ?? []).filter((task) => {
      if (!showCompleted && task.completed) return false;
      if (project !== "all" && !task.projects.includes(project)) return false;
      if (status !== "all" && task.status !== status) return false;
      if (priority !== "all" && task.priority !== priority) return false;
      if (
        normalizedQuery &&
        ![task.title, task.status, task.priority, ...task.projects]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [collection, priority, project, query, showCompleted, status]);
  const selected =
    collection?.tasks.find((task) => task.id === selectedId) ?? null;
  const unscheduled = visibleTasks.filter((task) => !taskSpan(task)).length;

  async function saveSchedule(task: PlannerTask, update: ScheduleUpdate) {
    const previous = task;
    setCollection((current) =>
      replaceCollectionTask(current, withSchedule(task, update)),
    );
    try {
      const saved = await repository.updateSchedule(task, update);
      setCollection((current) => replaceCollectionTask(current, saved));
    } catch (reason) {
      setCollection((current) => replaceCollectionTask(current, previous));
      throw reason;
    }
  }

  async function saveDependencies(
    task: PlannerTask,
    dependencies: readonly TaskDependency[],
  ) {
    const previous = task;
    setCollection((current) =>
      replaceCollectionTask(current, { ...task, blockedBy: [...dependencies] }),
    );
    try {
      const saved = await repository.updateDependencies(task, dependencies);
      setCollection((current) => replaceCollectionTask(current, saved));
    } catch (reason) {
      setCollection((current) => replaceCollectionTask(current, previous));
      throw reason;
    }
  }

  async function saveProperties(task: PlannerTask, update: TaskPropertyUpdate) {
    const saved = await repository.updateProperties(task, update);
    setCollection((current) => replaceCollectionTask(current, saved));
  }

  async function toggleCompletion(task: PlannerTask) {
    const saved = await repository.toggleCompletion(task);
    setCollection((current) => replaceCollectionTask(current, saved));
  }

  function chooseView(key: string) {
    const next = key || null;
    setActiveViewKey(next);
    setSelectedId(null);
    const url = new URL(location.href);
    if (next) url.searchParams.set("view", next);
    else url.searchParams.delete("view");
    history.replaceState(history.state, "", url);
  }

  function openSaveView() {
    setSaveName(collection?.activeView?.name ?? "");
    setSaveError("");
    setSaveOpen(true);
  }

  async function saveView(event: FormEvent) {
    event.preventDefault();
    if (!collection || !saveName.trim()) return;
    setSavingView(true);
    setSaveError("");
    try {
      const saved = await repository.saveView({
        name: saveName,
        ...(collection.activeView?.writable
          ? { view: collection.activeView }
          : {}),
        zoom,
        project,
        status,
        priority,
        showCompleted,
      });
      setSaveOpen(false);
      if (saved.key === activeViewKey) await load(true);
      else chooseView(saved.key);
    } catch (reason) {
      setSaveError(errorMessage(reason));
    } finally {
      setSavingView(false);
    }
  }

  if (loading && !collection) return <PlannerLoading />;
  if (!collection)
    return (
      <main className="fatal-state">
        <CircleAlert aria-hidden="true" size={28} />
        <h1>This collection could not be opened</h1>
        <p>{error || "The TaskNotes records are not available."}</p>
        <div>
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
          <button type="button" onClick={onChangeCollection}>
            Choose another collection
          </button>
        </div>
      </main>
    );

  return (
    <main className="planner-shell">
      <header className="planner-header">
        <div className="planner-brand">
          <img alt="" src="/tasknotes-mark.svg" />
          <div>
            <span>TaskNotes Planner</span>
            <button type="button" onClick={onChangeCollection}>
              <Database aria-hidden="true" size={13} />
              {collection.name}
              <ChevronDown aria-hidden="true" size={13} />
            </button>
          </div>
        </div>
        <div className="planner-heading">
          <p>Plan</p>
          <h1>{collection.activeView?.name ?? "Timeline"}</h1>
        </div>
        <div className="header-actions">
          <button
            className="save-view-control"
            type="button"
            onClick={openSaveView}
          >
            <BookmarkPlus aria-hidden="true" size={17} />
            <span>
              {collection.activeView?.writable ? "Save changes" : "Save view"}
            </span>
          </button>
          <ThemeButton />
          <button
            aria-label="Refresh tasks"
            disabled={refreshing}
            type="button"
            onClick={() => void load(true)}
          >
            <RefreshCw
              aria-hidden="true"
              className={refreshing ? "spin" : ""}
              size={18}
            />
          </button>
        </div>
      </header>

      <section className="planner-toolbar" aria-label="Timeline controls">
        <label className="select-control view-select-control">
          <span className="sr-only">Planner view</span>
          <select
            value={collection.activeView?.key ?? ""}
            onChange={(event) => chooseView(event.target.value)}
          >
            <option value="">All tasks</option>
            {collection.views.map((view) => (
              <option key={view.key} value={view.key}>
                {view.name}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={14} />
        </label>
        <label className="search-control">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">Search tasks</span>
          <input
            placeholder="Find a task"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="select-control">
          <span className="sr-only">Project</span>
          <select
            value={project}
            onChange={(event) => setProject(event.target.value)}
          >
            <option value="all">All projects</option>
            {projects.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={14} />
        </label>
        <label className="select-control compact-select-control">
          <span className="sr-only">Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            {collection.statuses.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={14} />
        </label>
        <label className="select-control compact-select-control">
          <span className="sr-only">Priority</span>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="all">All priorities</option>
            {collection.priorities.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={14} />
        </label>
        <button
          aria-pressed={showCompleted}
          className="toggle-control"
          type="button"
          onClick={() => setShowCompleted((value) => !value)}
        >
          <span>
            {showCompleted ? <Check aria-hidden="true" size={13} /> : null}
          </span>
          Completed
        </button>
        <span className="toolbar-spacer" />
        {unscheduled ? (
          <span className="unscheduled-count">{unscheduled} unscheduled</span>
        ) : null}
        <button
          className="today-control"
          type="button"
          onClick={() => setTodayRequest((value) => value + 1)}
        >
          <CalendarDays aria-hidden="true" size={16} />
          Today
        </button>
        <div className="zoom-control" aria-label="Timeline zoom">
          <button
            aria-label="Zoom out"
            disabled={zoom <= 0}
            type="button"
            onClick={() => setZoom((value) => clampZoom(value - 1))}
          >
            <ZoomOut aria-hidden="true" size={15} />
          </button>
          <output aria-live="polite">{zoomDefinition(zoom).label}</output>
          <button
            aria-label="Zoom in"
            disabled={zoom >= TIMELINE_ZOOMS.length - 1}
            type="button"
            onClick={() => setZoom((value) => clampZoom(value + 1))}
          >
            <ZoomIn aria-hidden="true" size={15} />
          </button>
        </div>
      </section>

      {error ? (
        <p className="planner-error" role="alert">
          Tasks may be out of date. {error}
        </p>
      ) : null}
      <GanttChart
        allTasks={collection.tasks}
        selectedId={selectedId}
        tasks={visibleTasks}
        todayRequest={todayRequest}
        zoom={zoom}
        onDependenciesChange={saveDependencies}
        onCompletionChange={toggleCompletion}
        onScheduleChange={saveSchedule}
        onSelect={(task) => setSelectedId(task.id)}
        onZoom={(direction) => setZoom((value) => clampZoom(value + direction))}
      />
      {selected ? (
        <TaskInspector
          allTasks={collection.tasks}
          key={selected.id}
          task={selected}
          onClose={() => setSelectedId(null)}
          onSaveDependencies={saveDependencies}
          onSaveProperties={saveProperties}
          onSave={saveSchedule}
        />
      ) : null}
      {saveOpen ? (
        <div className="planner-dialog-backdrop" role="presentation">
          <form
            aria-labelledby="save-view-title"
            className="planner-dialog"
            role="dialog"
            onSubmit={(event) => void saveView(event)}
          >
            <header>
              <div>
                <p>TaskNotes Base</p>
                <h2 id="save-view-title">
                  {collection.activeView?.writable
                    ? "Save Planner view"
                    : "Create Planner view"}
                </h2>
              </div>
              <button
                aria-label="Close"
                type="button"
                onClick={() => setSaveOpen(false)}
              >
                <X aria-hidden="true" size={19} />
              </button>
            </header>
            <label>
              <span>View name</span>
              <input
                autoFocus
                required
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
              />
            </label>
            <p>
              Saves the current filters and zoom as a reusable
              <code> tasknotesPlanner </code>view in TaskNotes/Views.
            </p>
            {saveError ? (
              <p className="form-error" role="alert">
                {saveError}
              </p>
            ) : null}
            <footer>
              <button
                className="text-action"
                type="button"
                onClick={() => setSaveOpen(false)}
              >
                Cancel
              </button>
              <button
                className="save-action"
                disabled={savingView || !saveName.trim()}
                type="submit"
              >
                {savingView ? "Saving…" : "Save view"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function replaceCollectionTask(
  collection: PlannerCollection | null,
  task: PlannerTask,
): PlannerCollection | null {
  return collection
    ? {
        ...collection,
        tasks: collection.tasks.map((candidate) =>
          candidate.id === task.id ? task : candidate,
        ),
      }
    : collection;
}

function ThemeButton() {
  const [dark, setDark] = useState(
    () =>
      document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme &&
        matchMedia("(prefers-color-scheme: dark)").matches),
  );
  return (
    <button
      aria-label={dark ? "Use light appearance" : "Use dark appearance"}
      type="button"
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.dataset.theme = next ? "dark" : "light";
        localStorage.setItem("mdbase:theme", next ? "dark" : "light");
      }}
    >
      {dark ? (
        <Sun aria-hidden="true" size={18} />
      ) : (
        <Moon aria-hidden="true" size={18} />
      )}
    </button>
  );
}

function PlannerLoading() {
  return (
    <main className="planner-loading">
      <img alt="" src="/tasknotes-mark.svg" />
      <p>Reading the plan…</p>
    </main>
  );
}

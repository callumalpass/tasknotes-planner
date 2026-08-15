import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  Moon,
  RefreshCw,
  Search,
  Sun,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { projectLabel, taskSpan, type TimelineZoom } from "../domain/gantt";
import { GanttChart } from "./gantt-chart";
import { TaskInspector } from "./task-inspector";
import { errorMessage } from "../data/outcome";

import type {
  PlannerCollection,
  PlannerRepository,
  PlannerTask,
  ScheduleUpdate,
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
  const [showCompleted, setShowCompleted] = useState(false);
  const [zoom, setZoom] = useState<TimelineZoom>("week");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [todayRequest, setTodayRequest] = useState(0);
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        setCollection(await repository.load());
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [repository],
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
      [
        ...new Set(
          collection?.tasks.flatMap((task) =>
            task.projects.map(projectLabel),
          ) ?? [],
        ),
      ].sort((left, right) => left.localeCompare(right)),
    [collection],
  );
  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (collection?.tasks ?? []).filter((task) => {
      if (!showCompleted && task.completed) return false;
      if (
        project !== "all" &&
        !task.projects.some((value) => projectLabel(value) === project)
      )
        return false;
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
  }, [collection, project, query, showCompleted]);
  const selected =
    collection?.tasks.find((task) => task.id === selectedId) ?? null;
  const unscheduled = visibleTasks.filter((task) => !taskSpan(task)).length;

  async function saveSchedule(task: PlannerTask, update: ScheduleUpdate) {
    const saved = await repository.updateSchedule(task, update);
    setCollection((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((candidate) =>
              candidate.id === saved.id ? saved : candidate,
            ),
          }
        : current,
    );
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
          <h1>Timeline</h1>
        </div>
        <div className="header-actions">
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
            {projects.map((value) => (
              <option key={value} value={value}>
                {value}
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
        <div className="zoom-control" aria-label="Timeline scale">
          {(["day", "week", "month"] as const).map((value) => (
            <button
              aria-pressed={zoom === value}
              key={value}
              type="button"
              onClick={() => setZoom(value)}
            >
              {value === "day" ? "Days" : value === "week" ? "Weeks" : "Months"}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <p className="planner-error" role="alert">
          Tasks may be out of date. {error}
        </p>
      ) : null}
      <GanttChart
        selectedId={selectedId}
        tasks={visibleTasks}
        todayRequest={todayRequest}
        zoom={zoom}
        onSelect={(task) => setSelectedId(task.id)}
      />
      {selected ? (
        <TaskInspector
          allTasks={collection.tasks}
          key={selected.id}
          task={selected}
          onClose={() => setSelectedId(null)}
          onSave={saveSchedule}
        />
      ) : null}
    </main>
  );
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

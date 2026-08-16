const connectOrigin =
  process.env.MDBASE_CONNECT_ORIGIN ?? "https://connect.mdbase.dev";
const appOrigin =
  process.env.TASKNOTES_PRODUCTION_URL ?? "https://planner.tasknotes.dev";
const validateWithConnect =
  process.env.TASKNOTES_REQUIRE_CONNECT_MANIFEST_VALIDATION !== "0";
const retryDelays = [3_000, 6_000, 12_000, 20_000, 30_000, 45_000, 60_000];

const checks = [
  async () => {
    const health = await json(`${connectOrigin}/health`);
    if (health.ok !== true || health.service !== "mdbase-connect")
      throw new Error("mdbase Connect returned an unexpected health response.");
  },
  async () => {
    const html = await text(`${appOrigin}/`);
    if (
      !html.includes('<div id="root"></div>') ||
      !html.includes("TaskNotes Planner")
    )
      throw new Error("The deployed Planner shell is incomplete.");
  },
  async () => {
    const manifest = await json(`${appOrigin}/.well-known/mdbase-app.json`);
    if (
      manifest.id !== "dev.tasknotes.planner" ||
      manifest.homepage !== `${appOrigin}/` ||
      manifest.redirect_uris?.length !== 1 ||
      manifest.redirect_uris[0] !== `${appOrigin}/auth/mdbase/callback` ||
      manifest.requirements?.access !== "full_collection" ||
      !manifest.requirements?.capabilities?.required?.includes("views.execute")
    )
      throw new Error("The deployed Planner mdbase manifest is invalid.");
    if (!validateWithConnect) return;
    const validation = await postJson(`${connectOrigin}/v1/apps/validate`, {
      manifest,
    });
    if (
      validation.valid !== true ||
      validation.declaration?.family_identity !== "bundle:dev.tasknotes.planner"
    )
      throw new Error("mdbase Connect rejected the Planner declaration.");
  },
  async () => {
    const callback = await text(`${appOrigin}/auth/mdbase/callback`);
    if (!callback.includes('<div id="root"></div>'))
      throw new Error(
        "The Planner authorization callback cannot load the app.",
      );
  },
  async () => {
    const response = await fetch(`${appOrigin}/?demo=1`, {
      headers: { "user-agent": "tasknotes-planner-smoke/1" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`Planner demo returned HTTP ${response.status}.`);
    if (response.headers.get("x-frame-options")?.toUpperCase() !== "DENY")
      throw new Error("Planner can be embedded unexpectedly.");
  },
];

for (const [index, check] of checks.entries()) {
  await retry(check);
  console.log(`Planner production check ${index + 1}/${checks.length} passed.`);
}
console.log("Planner production boundaries are healthy.");

async function retry(check) {
  let lastError;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < retryDelays.length) {
        console.warn(
          `${error instanceof Error ? error.message : String(error)} Retrying in ${retryDelays[attempt] / 1_000}s.`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelays[attempt]),
        );
      }
    }
  }
  throw lastError;
}

async function json(url) {
  return JSON.parse(await text(url));
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "tasknotes-planner-smoke/1",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload?.error?.message ?? `${url} returned HTTP ${response.status}.`,
    );
  return payload;
}

async function text(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "tasknotes-planner-smoke/1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.text();
}

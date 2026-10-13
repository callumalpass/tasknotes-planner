import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/azeret-mono/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { pageFor } from "./grant-return";
import "./styles.css";

// Decided once, before anything renders: a consent popup return never starts
// the SDK entry.
const page = pageFor(location.href, import.meta.env.VITE_MDBASE_ENV);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{page}</StrictMode>,
);

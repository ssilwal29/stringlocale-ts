/**
 * main.tsx — load the compiled bundles once, then mount the app.
 *
 * `loadFromUrl` fetches /i18n/manifest.json and wires lazy per-locale loading.
 * `preload` eagerly fetches the locales you know you'll show first so there's
 * no flash of the fallback locale on initial render.
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { convertDigits, loadFromUrl } from "stringlocale";

import App from "./App";
import "./styles.css";

// The adapter for `Param.userAdapted` values. It runs at resolve time on free
// user text — here it localizes the digits inside it (1200 -> १२०० in Nepali,
// ١٢٠٠ in Arabic). Omit it and userAdapted behaves like Param.user().
const adaptDigits = (locale: string, _context: string | undefined, text: string) =>
  convertDigits(text, locale);

async function bootstrap() {
  const store = await loadFromUrl("/i18n", {
    preload: ["ne-NP"],
    adapter: adaptDigits,
  });
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <React.StrictMode>
      <App store={store} />
    </React.StrictMode>,
  );
}

bootstrap();

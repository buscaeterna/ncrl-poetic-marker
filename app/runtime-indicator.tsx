"use client";

import { useEffect, useState } from "react";
import { connectionLabel, initialConnectionState, runtimeMode, type ConnectionState } from "./runtime-status";

const MODE = runtimeMode(process.env.NEXT_PUBLIC_RUNTIME_MODE);

export function RuntimeIndicator() {
  const [state, setState] = useState<ConnectionState>(() => initialConnectionState(MODE));

  useEffect(() => {
    if (MODE === "static") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    fetch("/api/v1/health", { signal: controller.signal, cache: "no-store" })
      .then((response) => setState(response.ok ? "connected" : "unavailable"))
      .catch(() => setState("unavailable"))
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, []);

  return <span className={`runtime-status runtime-${state}`} role="status" aria-live="polite">{connectionLabel(state)}</span>;
}

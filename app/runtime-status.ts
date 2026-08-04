export type RuntimeMode = "static" | "full";
export type ConnectionState = "static" | "checking" | "connected" | "unavailable";

export const runtimeMode = (value: string | undefined): RuntimeMode =>
  value === "static" ? "static" : "full";

export const initialConnectionState = (mode: RuntimeMode): ConnectionState =>
  mode === "static" ? "static" : "checking";

export const connectionLabel = (state: ConnectionState) => {
  if (state === "static") return "Автономный режим";
  if (state === "connected") return "Локальный сервер подключён";
  if (state === "unavailable") return "Локальный сервер недоступен";
  return "Проверка локального сервера…";
};

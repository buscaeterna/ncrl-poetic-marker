import assert from "node:assert/strict";
import test from "node:test";
import { connectionLabel, initialConnectionState, runtimeMode } from "../app/runtime-status.ts";

test("static mode never starts an API check", () => {
  assert.equal(runtimeMode("static"), "static");
  assert.equal(initialConnectionState("static"), "static");
  assert.equal(connectionLabel("static"), "Автономный режим");
});

test("full mode exposes connection states", () => {
  assert.equal(runtimeMode("full"), "full");
  assert.equal(initialConnectionState("full"), "checking");
  assert.equal(connectionLabel("connected"), "Локальный сервер подключён");
  assert.equal(connectionLabel("unavailable"), "Локальный сервер недоступен");
});

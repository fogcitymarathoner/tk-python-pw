import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { invoke } from "./mocks/tauri";

if (!navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: jest.fn().mockResolvedValue(undefined) },
  });
}

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  window.prompt = jest.fn();
  jest.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  URL.createObjectURL = jest.fn(() => "blob:mock");
  URL.revokeObjectURL = jest.fn();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

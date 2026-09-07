import { render, waitFor, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { invoke } from "./mocks/tauri";
import { createBackend, type BackendSeed } from "./backend";

export async function renderApp(seed: BackendSeed = {}) {
  const backend = createBackend(seed);
  invoke.mockImplementation(backend.impl);
  const user = userEvent.setup();
  const view = render(<App />);
  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("get_categories", expect.any(Object));
  });
  return { user, backend, ...view };
}

export async function renderAppUntilStatus(seed: BackendSeed, matcher: RegExp | string) {
  const backend = createBackend(seed);
  invoke.mockImplementation(backend.impl);
  const user = userEvent.setup();
  const view = render(<App />);
  await waitFor(() => {
    expect(screen.getByText(matcher)).toBeInTheDocument();
  });
  return { user, backend, ...view };
}

export async function openTab(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) {
  await user.click(screen.getByRole("button", { name }));
}

export function activePanel() {
  return document.querySelector(".tab-panel.active") as HTMLElement;
}

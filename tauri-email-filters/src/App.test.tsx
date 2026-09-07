import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { invoke } from "./test/mocks/tauri";
import { EMPTY_FEED_XML, SAMPLE_XML } from "./test/fixtures";

function enableTauri() {
  (window as unknown as { __TAURI_INTERNALS__: { invoke: typeof invoke } }).__TAURI_INTERNALS__ = {
    invoke,
  };
}

function backend(content = SAMPLE_XML, extras: Record<string, unknown> = {}) {
  invoke.mockImplementation(async (cmd: string, _args: Record<string, unknown> = {}) => {
    if (extras.fail && (extras.fail as Record<string, string>)[cmd]) {
      throw (extras.fail as Record<string, string>)[cmd];
    }
    switch (cmd) {
      case "read_filters_file":
        return content;
      case "read_filters_from_path":
        return extras.readContent ?? content;
      case "write_filters_file":
      case "write_filters_to_path":
      case "write_report_file":
        return;
      case "select_filters_file":
        return "selectPath" in extras ? extras.selectPath : "C:\\\\data\\\\custom.xml";
      case "select_save_path":
        return "savePath" in extras ? extras.savePath : "C:\\\\data\\\\saved.xml";
      default:
        throw new Error(`unknown ${cmd}`);
    }
  });
}

function expectStatus(text: string | RegExp) {
  expect(screen.getAllByText(text).length).toBeGreaterThan(0);
}

async function expectStatusSoon(text: string | RegExp) {
  expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
}

function filterCard(n: number) {
  const indexes = screen.getAllByText(`#${n}`, { selector: ".entry-index" });
  return indexes[0].closest(".entry-card") as HTMLElement;
}

async function renderTauri(content = SAMPLE_XML, extras: Record<string, unknown> = {}) {
  enableTauri();
  backend(content, extras);
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => {
    expect(screen.queryByText("Initializing application...")).not.toBeInTheDocument();
  });
  return { user };
}

describe("App loading", () => {
  it("loads native mailFilters.xml in Tauri", async () => {
    await renderTauri();
    expectStatus("Natively loaded mailFilters.xml");
    expect(screen.getByText("From: alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Desktop App")).toBeInTheDocument();
    expect(screen.getByText("Filter Configuration")).toBeInTheDocument();
    expect(screen.queryByText("Scanning filesystem...")).not.toBeInTheDocument();
  });

  it("reloads a stored custom path unless the cache is modified", async () => {
    localStorage.setItem("tauri_email_filters_current_path", "D:\\\\mail\\\\work.xml");
    await renderTauri();
    expect(invoke).toHaveBeenCalledWith("read_filters_from_path", { path: "D:\\\\mail\\\\work.xml" });
    expectStatus("Loaded work.xml");
    expect(screen.getByText("📍 work.xml")).toBeInTheDocument();
  });

  it("keeps a modified cached session instead of reloading disk", async () => {
    localStorage.setItem("tauri_email_filters_cached_xml", SAMPLE_XML);
    localStorage.setItem("tauri_email_filters_cached_status", "modified");
    localStorage.setItem("tauri_email_filters_cached_status_msg", "Unsaved changes present");
    enableTauri();
    backend();
    render(<App />);
    await expectStatusSoon("Unsaved changes restored from last active session");
    expect(invoke).not.toHaveBeenCalledWith("read_filters_file");
  });

  it("falls back to cache when a disk load fails", async () => {
    localStorage.setItem("tauri_email_filters_cached_xml", SAMPLE_XML);
    localStorage.setItem("tauri_email_filters_cached_status", "loaded");
    enableTauri();
    backend(SAMPLE_XML, { fail: { read_filters_file: "disk lag" } });
    render(<App />);
    await expectStatusSoon(/Failed to sync disk: disk lag/);
    expect(screen.getByText("From: alice@example.com")).toBeInTheDocument();
  });

  it("shows an error when Tauri load fails with no cache", async () => {
    enableTauri();
    backend(SAMPLE_XML, { fail: { read_filters_file: "missing" } });
    render(<App />);
    await expectStatusSoon("Failed to load: missing");
    expect(screen.getByText("No Active Filter Data Loaded")).toBeInTheDocument();
  });

  it("uses browser preview mode without Tauri", async () => {
    render(<App />);
    await expectStatusSoon(/Running in web preview mode/);
    expect(screen.getByText("Web Browser")).toBeInTheDocument();
  });

  it("restores a cached session without a stored status message", async () => {
    localStorage.setItem("tauri_email_filters_cached_xml", SAMPLE_XML);
    render(<App />);
    expect(screen.getByText("From: alice@example.com")).toBeInTheDocument();
    expect(screen.getAllByText(/Session restored|web preview mode/).length).toBeGreaterThan(0);
  });

  it("loads an empty native feed", async () => {
    await renderTauri(EMPTY_FEED_XML);
    expect(screen.getByText("No Active Filter Data Loaded")).toBeInTheDocument();
    expectStatus("Natively loaded mailFilters.xml");
  });
});

describe("App editing and file actions", () => {
  it("edits fields, searches, switches sort view, and clears search", async () => {
    const { user } = await renderTauri();
    await user.clear(screen.getByPlaceholderText(/Sender address/));
    await user.type(screen.getByPlaceholderText(/Sender address/), "team@corp.com");
    expectStatus("Unsaved changes present");
    expect(screen.getByDisplayValue("team@corp.com")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Recipient email/), "inbox@corp.com");
    await user.type(screen.getByPlaceholderText(/Email subject/), "Q3 review");
    await user.clear(screen.getByPlaceholderText(/Gmail folder/));
    await user.type(screen.getByPlaceholderText(/Gmail folder/), "Finance");
    await user.type(screen.getByPlaceholderText(/Forwarding email/), "ops@corp.com");

    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "s_ss");
    await user.selectOptions(selects[1], "s_skb");

    await user.click(screen.getByLabelText("Skip the Inbox (Archive)"));
    await user.click(screen.getByLabelText("Skip the Inbox (Archive)"));
    await user.click(screen.getByLabelText("Mark as Read"));
    await user.click(screen.getByLabelText("Never mark as important"));
    await user.click(screen.getByLabelText("Delete it (Trash)"));

    await user.type(screen.getByPlaceholderText(/Search filters/), "invoice");
    expect(screen.queryByText("From: team@corp.com")).not.toBeInTheDocument();
    expect(screen.getByText("Subj: Invoice 2026")).toBeInTheDocument();
    await user.click(screen.getByTitle("Clear search"));
    expect(screen.getByPlaceholderText(/Search filters/)).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /Compact Sort/ }));
    expect(screen.queryByText("Filter Configuration")).not.toBeInTheDocument();
    expect(screen.getByText("Fwd: ops@corp.com")).toBeInTheDocument();
    expect(screen.getAllByText("Archive").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No-Important").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Trash").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Edit Details/ }));
    expect(screen.getByText("Filter Configuration")).toBeInTheDocument();
  });

  it("adds, duplicates, reorders, and deletes filters", async () => {
    const { user } = await renderTauri();
    await user.click(screen.getByRole("button", { name: /Add New Filter/ }));
    expect(screen.getAllByText("#1", { selector: ".entry-index" }).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("Greater than (s_sl)")).toBeInTheDocument();

    await user.click(within(filterCard(1)).getByTitle("Duplicate Filter"));
    expect(screen.getAllByText("#2", { selector: ".entry-index" }).length).toBeGreaterThan(0);

    await user.click(within(filterCard(2)).getByTitle("Move Down"));
    await user.click(within(filterCard(2)).getByTitle("Move Up"));

    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    await user.click(within(filterCard(1)).getByTitle("Delete Filter"));
    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    await user.click(within(filterCard(1)).getByTitle("Delete Filter"));
    expectStatus("Unsaved changes present");
  });

  it("uses compact-sort actions and live pointer reorder", async () => {
    const { user } = await renderTauri();
    await user.click(screen.getByRole("button", { name: /Compact Sort/ }));
    await user.click(within(filterCard(1)).getByTitle("Duplicate Filter"));
    await user.click(within(filterCard(2)).getByTitle("Move Down"));
    await user.click(within(filterCard(2)).getByTitle("Move Up"));
    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    await user.click(within(filterCard(3)).getByTitle("Delete Filter"));

    fireEvent.pointerDown(filterCard(1));
    expect(document.querySelector(".dragging-active")).not.toBeNull();
    fireEvent.pointerEnter(filterCard(2));
    fireEvent.pointerUp(filterCard(2));
    fireEvent.pointerUp(window);
    expectStatus("Unsaved changes present");
  });

  it("opens the hidden file picker in browser mode", async () => {
    const user = userEvent.setup();
    render(<App />);
    await expectStatusSoon(/web preview mode/);
    const clickSpy = jest.fn();
    const input = document.getElementById("browser-file-upload") as HTMLInputElement;
    input.click = clickSpy;
    await user.click(screen.getByRole("button", { name: /Open File/ }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it("saves to the default file and shows a toast", async () => {
    const { user } = await renderTauri();
    await user.click(screen.getByRole("button", { name: /Save Changes/ }));
    await expectStatusSoon(/Successfully saved mailFilters.xml/);
    expect(screen.getByText(/Written to mailFilters.xml/)).toBeInTheDocument();
  });

  it("saves a previously opened custom path", async () => {
    localStorage.setItem("tauri_email_filters_current_path", "D:\\\\mail\\\\work.xml");
    const { user } = await renderTauri();
    await user.click(screen.getByRole("button", { name: /Save Changes/ }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "write_filters_to_path",
        expect.objectContaining({ path: "D:\\\\mail\\\\work.xml" }),
      );
    });
    await expectStatusSoon(/Successfully saved work.xml/);
  });

  it("opens a custom file and supports save-as plus report copy", async () => {
    const { user } = await renderTauri();
    await user.click(screen.getByRole("button", { name: /Open File/ }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("select_filters_file");
    });
    await expectStatusSoon("Loaded custom.xml");

    await user.click(screen.getByRole("button", { name: /Save As/ }));
    await expectStatusSoon(/Successfully saved as saved.xml/);

    await user.click(screen.getByRole("button", { name: /Copy Report/ }));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      "write_report_file",
      expect.objectContaining({ content: expect.stringContaining("Filter #1") }),
    );
    expectStatus(/report copied to clipboard/);
  });

  it("handles cancelled file dialogs and save failures", async () => {
    const { user } = await renderTauri();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "select_filters_file") return null;
      if (cmd === "select_save_path") return null;
      if (cmd === "write_filters_file") throw "denied";
      if (cmd === "read_filters_file") return SAMPLE_XML;
      return SAMPLE_XML;
    });
    await user.click(screen.getByRole("button", { name: /Open File/ }));
    await expectStatusSoon("Natively loaded mailFilters.xml");
    await user.click(screen.getByRole("button", { name: /Save As/ }));
    await expectStatusSoon("Natively loaded mailFilters.xml");
    await user.click(screen.getByRole("button", { name: /Save Changes/ }));
    await expectStatusSoon("Failed to save: denied");
  });

  it("reports an open-file error", async () => {
    const { user } = await renderTauri(SAMPLE_XML, { fail: { select_filters_file: "picker down" } });
    await user.click(screen.getByRole("button", { name: /Open File/ }));
    await expectStatusSoon("Failed to open: picker down");
  });

  it("reports a save-as error", async () => {
    const { user } = await renderTauri(SAMPLE_XML, { fail: { select_save_path: "disk full" } });
    await user.click(screen.getByRole("button", { name: /Save As/ }));
    await expectStatusSoon("Failed to save: disk full");
  });

  it("cancels open when no filters are loaded", async () => {
    const { user } = await renderTauri(EMPTY_FEED_XML, { selectPath: null });
    await user.click(screen.getAllByRole("button", { name: /Open XML File/ })[0]);
    await expectStatusSoon("No file selected.");
  });

  it("opens an empty custom file and swallows report write failures", async () => {
    const { user } = await renderTauri(SAMPLE_XML, {
      selectPath: "C:\\\\data\\\\empty.xml",
      readContent: EMPTY_FEED_XML,
      fail: { write_report_file: "report denied" },
    });
    await user.click(screen.getByRole("button", { name: /Open File/ }));
    await expectStatusSoon("Loaded empty.xml");
    expect(screen.getByText("No Active Filter Data Loaded")).toBeInTheDocument();
  });

  it("copies a report even when the clipboard API rejects", async () => {
    const { user } = await renderTauri();
    (navigator.clipboard.writeText as jest.Mock).mockRejectedValueOnce(new Error("blocked"));
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "write_report_file") throw "denied";
      if (cmd === "read_filters_file") return SAMPLE_XML;
      return SAMPLE_XML;
    });
    await user.click(screen.getByRole("button", { name: /Copy Report/ }));
    await expectStatusSoon(/report copied to clipboard/);
  });

  it("supports browser upload, download, and pointer reorder", async () => {
    const user = userEvent.setup();
    render(<App />);
    await expectStatusSoon(/web preview mode/);

    const file = new File([SAMPLE_XML], "mailFilters.xml", { type: "text/xml" });
    const input = document.getElementById("browser-file-upload") as HTMLInputElement;
    await user.upload(input, file);
    await expectStatusSoon("Loaded mailFilters.xml");

    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: /Save Changes/ }));
    await expectStatusSoon("File downloaded successfully!");
    await user.click(screen.getByRole("button", { name: /Save As/ }));
    await user.click(screen.getByRole("button", { name: /Copy Report/ }));
    clickSpy.mockRestore();

    fireEvent.pointerDown(filterCard(1));
    fireEvent.pointerEnter(filterCard(2));
    fireEvent.pointerUp(window);
    expectStatus("Unsaved changes present");
  });

  it("ignores pointer-down on action buttons and cancelled uploads", async () => {
    const { user } = await renderTauri();
    fireEvent.pointerDown(within(filterCard(1)).getByTitle("Move Down"));
    expect(document.querySelector(".dragging-active")).toBeNull();
    const input = document.getElementById("browser-file-upload") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    await user.click(screen.getByRole("button", { name: /Open File/ }));
  });

  it("adds a filter in front of the selected card", async () => {
    const { user } = await renderTauri();
    await user.click(filterCard(2));
    await user.click(screen.getByRole("button", { name: /Add New Filter/ }));
    expect(screen.getByDisplayValue("Greater than (s_sl)")).toBeInTheDocument();
    expect(screen.getByText(/Active Filters:/).textContent).toContain("3");
  });
});

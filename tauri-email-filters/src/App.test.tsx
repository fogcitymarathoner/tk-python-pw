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

let mockSqliteEntries: any[] = [];

function backend(content = SAMPLE_XML, extras: Record<string, unknown> = {}) {
  mockSqliteEntries = [];
  invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
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
      case "set_window_title":
        return;
      case "select_filters_file":
        return "selectPath" in extras ? extras.selectPath : "C:\\\\data\\\\custom.xml";
      case "select_save_path":
        return "savePath" in extras ? extras.savePath : "C:\\\\data\\\\saved.xml";
      case "select_eml_file":
        return "emlPath" in extras ? extras.emlPath : "C:\\\\data\\\\sample.eml";
      case "read_eml_file":
        return (
          extras.emlContent ??
          "From: alice@example.com\nTo: bob@example.com\nSubject: Invoice 2026\n\nSample body"
        );
      case "get_initial_file_path":
        return "initialFile" in extras ? extras.initialFile : null;
      case "populate_sqlite":
        mockSqliteEntries = (args.entries as any[]) || [];
        return "mailFilters.db";
      case "export_sqlite": {
        // Detect duplicates via mock SQLite logic
        const seen = new Set<string>();
        for (const entry of mockSqliteEntries) {
          const parts: string[] = [];
          for (const k of Object.keys(entry.properties || {}).sort()) {
            const v = entry.properties[k]?.trim();
            if (v) parts.push(`${k}=${v}`);
          }
          const hash = parts.join(";");
          if (seen.has(hash)) {
            throw "Duplicate filters detected! All filters must be distinct to save.";
          }
          seen.add(hash);
        }
        return mockSqliteEntries;
      }
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
    const { user } = await renderTauri();
    expectStatus("Natively loaded mailFilters.xml");
    expect(screen.getByText("From: alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Desktop App")).toBeInTheDocument();
    await user.click(filterCard(1));
    expect(screen.getByText("Filter #1 Configuration")).toBeInTheDocument();
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
    await user.click(filterCard(1));
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

    // Close the modal before searching
    await user.click(screen.getByRole("button", { name: /Done/ }));

    await user.type(screen.getByPlaceholderText(/Search filters/), "invoice");
    expect(screen.queryByText("From: team@corp.com")).not.toBeInTheDocument();
    expect(screen.getByText("Subj: Invoice 2026")).toBeInTheDocument();
    await user.click(screen.getByTitle("Clear search"));
    expect(screen.getByPlaceholderText(/Search filters/)).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /Compact Sort/ }));
    expect(screen.getByText("Fwd: ops@corp.com")).toBeInTheDocument();
    expect(screen.getAllByText("Archive").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No-Important").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Trash").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Edit Details/ }));

    await user.click(filterCard(1));
    expect(screen.getByText("Filter #1 Configuration")).toBeInTheDocument();
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
    expectStatus("Natively loaded mailFilters.xml");
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
    await user.click(filterCard(1));
    await user.type(screen.getByPlaceholderText(/Sender address/), "test@example.com");
    await user.click(screen.getByRole("button", { name: /Done/ }));
    await user.click(screen.getByRole("button", { name: /Save Changes/ }));
    await expectStatusSoon(/Successfully saved mailFilters.xml/);
    expect(screen.getByText(/Written to mailFilters.xml/)).toBeInTheDocument();
  });

  it("saves a previously opened custom path", async () => {
    localStorage.setItem("tauri_email_filters_current_path", "D:\\\\mail\\\\work.xml");
    const { user } = await renderTauri();
    await user.click(filterCard(1));
    await user.type(screen.getByPlaceholderText(/Sender address/), "test@example.com");
    await user.click(screen.getByRole("button", { name: /Done/ }));
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

    await user.click(filterCard(1));
    await user.type(screen.getByPlaceholderText(/Sender address/), "test@example.com");
    await user.click(screen.getByRole("button", { name: /Done/ }));
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
    invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "select_filters_file") return null;
      if (cmd === "select_save_path") return null;
      if (cmd === "write_filters_file") throw "denied";
      if (cmd === "read_filters_file") return SAMPLE_XML;
      if (cmd === "populate_sqlite") {
        mockSqliteEntries = (args.entries as any[]) || [];
        return "mailFilters.db";
      }
      if (cmd === "export_sqlite") return mockSqliteEntries;
      return SAMPLE_XML;
    });
    await user.click(screen.getByRole("button", { name: /Open File/ }));
    await expectStatusSoon("Natively loaded mailFilters.xml");
    await user.click(filterCard(1));
    await user.type(screen.getByPlaceholderText(/Sender address/), "test@example.com");
    await user.click(screen.getByRole("button", { name: /Done/ }));
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
    await user.click(filterCard(1));
    await user.type(screen.getByPlaceholderText(/Sender address/), "test@example.com");
    await user.click(screen.getByRole("button", { name: /Done/ }));
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

    await user.click(filterCard(1));
    await user.type(screen.getByPlaceholderText(/Sender address/), "test@example.com");
    await user.click(screen.getByRole("button", { name: /Done/ }));

    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: /Save Changes/ }));
    await expectStatusSoon("File downloaded successfully!");

    await user.click(filterCard(1));
    await user.type(screen.getByPlaceholderText(/Sender address/), "test2@example.com");
    await user.click(screen.getByRole("button", { name: /Done/ }));
    await user.click(screen.getByRole("button", { name: /Save As/ }));
    await user.click(screen.getByRole("button", { name: /Copy Report/ }));
    clickSpy.mockRestore();

    fireEvent.pointerDown(filterCard(1));
    fireEvent.pointerEnter(filterCard(2));
    fireEvent.pointerUp(window);
    expectStatus("Unsaved changes present");
  });

  it("disables Save and Save As buttons when there are no changes, enables on edit, disables on revert, and disables after save", async () => {
    const { user } = await renderTauri();

    const saveBtn = screen.getByRole("button", { name: /Save Changes/ });
    const saveAsBtn = screen.getByRole("button", { name: /Save As/ });

    // 1. Initially disabled when loaded with no changes
    expect(saveBtn).toBeDisabled();
    expect(saveAsBtn).toBeDisabled();

    // 2. Making a change enables Save and Save As
    await user.click(filterCard(1));
    const senderInput = screen.getByPlaceholderText(/Sender address/);
    await user.clear(senderInput);
    await user.type(senderInput, "new-sender@domain.com");

    expect(saveBtn).toBeEnabled();
    expect(saveAsBtn).toBeEnabled();
    expectStatus("Unsaved changes present");

    // 3. Reverting the change back to original value disables Save and Save As again
    await user.clear(senderInput);
    await user.type(senderInput, "alice@example.com");

    expect(saveBtn).toBeDisabled();
    expect(saveAsBtn).toBeDisabled();
    expectStatus("Natively loaded mailFilters.xml");

    // 4. Editing again and saving disables Save and Save As after save
    await user.clear(senderInput);
    await user.type(senderInput, "modified@domain.com");
    expect(saveBtn).toBeEnabled();
    expect(saveAsBtn).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /Done/ }));
    await user.click(saveBtn);
    await expectStatusSoon(/Successfully saved mailFilters.xml/);

    expect(saveBtn).toBeDisabled();
    expect(saveAsBtn).toBeDisabled();
  });

  it("ignores pointer-down on action buttons and cancelled uploads", async () => {
    const { user } = await renderTauri();
    fireEvent.pointerDown(within(filterCard(1)).getByTitle("Move Down"));
    expect(document.querySelector(".dragging-active")).toBeNull();
    const input = document.getElementById("browser-file-upload") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    await user.click(screen.getByRole("button", { name: /Open File/ }));
  });

  it("adds a filter in front of the selected card with empty filter badge and without auto-scroll", async () => {
    const { user } = await renderTauri();
    await user.click(filterCard(2));
    await user.click(screen.getByRole("button", { name: /Add New Filter/ }));
    expect(screen.getByDisplayValue("Greater than (s_sl)")).toBeInTheDocument();
    expect(screen.getByText(/Active Filters:/).textContent).toContain("3");
    expect(within(filterCard(2)).getByText("New / Empty Filter")).toBeInTheDocument();
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("auto-scrolls to newly added filter when no filter is selected", async () => {
    const { user } = await renderTauri();
    const scrollContainer = document.querySelector(".entries-list-scroll") as HTMLElement;
    fireEvent.click(scrollContainer);

    (window.prompt as jest.Mock).mockReturnValueOnce("2");
    await user.click(screen.getByRole("button", { name: /Add New Filter/ }));

    expect(window.prompt).toHaveBeenCalledWith(expect.stringContaining("No filter is selected"));
    expect(within(filterCard(2)).getByText("New / Empty Filter")).toBeInTheDocument();
    await waitFor(() => {
      expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });

  it("removes empty filter badge once criteria is entered", async () => {
    const { user } = await renderTauri();
    await user.click(screen.getByRole("button", { name: /Add New Filter/ }));
    expect(within(filterCard(1)).getByText("New / Empty Filter")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Sender address, domain, or query..."), "test@domain.com");
    expect(within(filterCard(1)).queryByText("New / Empty Filter")).not.toBeInTheDocument();
    expect(within(filterCard(1)).getByText("From: test@domain.com")).toBeInTheDocument();
  });

  it("disables Save and Save As buttons when a newly added filter is removed", async () => {
    const { user } = await renderTauri();

    const saveBtn = screen.getByRole("button", { name: /Save Changes/ });
    const saveAsBtn = screen.getByRole("button", { name: /Save As/ });

    expect(saveBtn).toBeDisabled();
    expect(saveAsBtn).toBeDisabled();

    // Add a new filter
    await user.click(screen.getByRole("button", { name: /Add New Filter/ }));

    expect(saveBtn).toBeEnabled();
    expect(saveAsBtn).toBeEnabled();
    expectStatus("Unsaved changes present");

    // Remove the newly added filter
    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    await user.click(within(filterCard(1)).getByTitle("Delete Filter"));

    // Buttons should be disabled again
    await waitFor(() => {
      expect(saveBtn).toBeDisabled();
      expect(saveAsBtn).toBeDisabled();
    });
    await expectStatusSoon(/Natively loaded mailFilters\.xml/);
  });

  it("displays unified file and status indicator when editing custom file", async () => {
    localStorage.setItem("tauri_email_filters_current_path", "C:\\data\\mailFiltersFog.xml");
    const { user } = await renderTauri(SAMPLE_XML, {
      read_filters_from_path: SAMPLE_XML,
    });

    const statusBadge = document.querySelector(".status-badge");
    expect(statusBadge).not.toBeNull();
    expect(statusBadge?.textContent).toContain("📍 mailFiltersFog.xml");
    // Verify old separate file-path-badge is NOT rendered
    expect(document.querySelector(".file-path-badge")).toBeNull();

    // Modify a property to trigger unsaved changes
    await user.click(filterCard(1));
    await user.type(screen.getByPlaceholderText(/Sender address/), "user@example.com");

    // Unified badge should now show both the pin filename and unsaved changes status
    expect(statusBadge?.textContent).toContain("📍 mailFiltersFog.xml");
    expect(statusBadge?.textContent).toContain("Unsaved changes present");
    expect(statusBadge?.classList.contains("warning")).toBe(true);
  });

  it("detects duplicate filters on save, blocks writing XML, and shows duplicate badge", async () => {
    const { user } = await renderTauri();

    // Duplicate filter 1 so that we have an exact duplicate
    await user.click(within(filterCard(1)).getByTitle("Duplicate Filter"));
    expect(screen.getAllByText(/Duplicate Filter/).length).toBeGreaterThan(0);

    const saveBtn = screen.getByRole("button", { name: /Save Changes/ });
    expect(saveBtn).toBeEnabled();

    // Attempting to save should trigger duplicate detection from SQLite export
    await user.click(saveBtn);
    await expectStatusSoon(/Duplicate filters detected! All filters must be distinct to save/);
    expect(invoke).not.toHaveBeenCalledWith("write_filters_file", expect.anything());

    // Resolve the duplicate by changing a property
    await user.click(filterCard(2));
    const senderInput = screen.getByPlaceholderText(/Sender address/);
    await user.clear(senderInput);
    await user.type(senderInput, "distinct-sender@example.com");

    // The duplicate badge should be gone
    expect(document.querySelector(".badge-duplicate")).toBeNull();

    // Save should now succeed and export from SQLite
    await user.click(saveBtn);
    await expectStatusSoon(/Successfully saved mailFilters\.xml/);
    expect(invoke).toHaveBeenCalledWith("write_filters_file", expect.anything());
  });

  it("detects duplicate filters in browser preview mode and prevents download", async () => {
    const user = userEvent.setup();
    render(<App />);
    const file = new File([SAMPLE_XML], "mailFilters.xml", { type: "text/xml" });
    const input = document.getElementById("browser-file-upload") as HTMLInputElement;
    await user.upload(input, file);
    await expectStatusSoon("Loaded mailFilters.xml");

    // Duplicate filter 1
    await user.click(within(filterCard(1)).getByTitle("Duplicate Filter"));
    expect(document.querySelectorAll(".badge-duplicate").length).toBeGreaterThan(0);

    const saveBtn = screen.getByRole("button", { name: /Save Changes/ });
    await user.click(saveBtn);
    await expectStatusSoon(/Duplicate filters detected! All filters must be distinct to save/);
  });

  it("opens EML tester modal, loads an .eml file, and reports matching filters", async () => {
    const { user } = await renderTauri();

    // Click the Test Email button to open the modal
    const testBtn = screen.getByRole("button", { name: /Test Email/ });
    await user.click(testBtn);

    expect(screen.getByText("EML Filter Tester")).toBeInTheDocument();

    // Click Select .eml File
    const selectFileBtn = screen.getByRole("button", { name: /Select \.eml File/ });
    await user.click(selectFileBtn);

    // Expect email details to be rendered
    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
      expect(screen.getByText("Invoice 2026")).toBeInTheDocument();
    });

    // Both filters in SAMPLE_XML match this email
    expect(screen.getByText(/2 of 2 filters match this email/)).toBeInTheDocument();

    // Verify cumulative action badges
    expect(screen.getAllByText("Label: Work").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Archive").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Trash").length).toBeGreaterThan(0);

    // Jump to Filter #2
    const jumpBtns = screen.getAllByRole("button", { name: /Jump to Filter/ });
    expect(jumpBtns.length).toBe(2);
    await user.click(jumpBtns[1]);

    // Modal should close and Filter #2 should be selected
    expect(screen.queryByText("EML Filter Tester")).not.toBeInTheDocument();
  });

  it("loads CLI specified filter file on startup and sets active path", async () => {
    const { user: _ } = await renderTauri(SAMPLE_XML, {
      initialFile: "C:\\data\\clientA.xml",
      readContent: SAMPLE_XML,
    });

    await expectStatusSoon(/Loaded clientA\.xml/);
    const statusBadge = document.querySelector(".status-badge");
    expect(statusBadge?.textContent).toContain("clientA.xml");
  });

  it("updates top title bar and window title to Filter XXX for mailFiltersXXX.xml", async () => {
    const { user: _ } = await renderTauri(SAMPLE_XML, {
      initialFile: "C:\\data\\mailFiltersFog.xml",
      readContent: SAMPLE_XML,
    });

    await waitFor(() => {
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toBe("Filter Fog");
      expect(document.title).toBe("Filter Fog");
    });
  });

  it("opens centered edit modal popup on card or edit button click, edits fields, and closes with Done or Escape", async () => {
    const { user } = await renderTauri();

    // Modal is initially not open
    expect(screen.queryByText("Filter #1 Configuration")).not.toBeInTheDocument();

    // Click filter card to open centered edit modal popup
    await user.click(filterCard(1));
    expect(screen.getByText("Filter #1 Configuration")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Sender address/)).toHaveValue("alice@example.com");

    // Close via Done button
    await user.click(screen.getByRole("button", { name: /Done/ }));
    expect(screen.queryByText("Filter #1 Configuration")).not.toBeInTheDocument();

    // Click edit icon button on card 2 to open modal
    const editBtn = within(filterCard(2)).getByTitle("Edit Filter");
    await user.click(editBtn);
    expect(screen.getByText("Filter #2 Configuration")).toBeInTheDocument();

    // Dismiss with Escape key
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Filter #2 Configuration")).not.toBeInTheDocument();
  });
});

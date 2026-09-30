import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  PW_COLUMN_DEFAULTS,
  PW_COLUMN_KEYS,
  PW_COLUMN_MAX,
  PW_COLUMN_MIN,
  PW_COLUMN_STORAGE_KEY,
  type PwColumnKey,
} from "./lib/columnWidths";
import { invoke } from "./test/mocks/tauri";
import { activePanel, openTab, renderApp } from "./test/renderApp";

describe("Passwords tab", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function openPasswords() {
    const ctx = await renderApp();
    await openTab(ctx.user, /Passwords/);
    return ctx;
  }

  it("lists, searches, clears, and sorts passwords", async () => {
    const { user } = await openPasswords();
    const panel = () => within(activePanel());
    expect(panel().getByText("GitHub")).toBeInTheDocument();
    expect(panel().getByText("Adobe")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search passwords..."), "git");
    expect(panel().getByText("GitHub")).toBeInTheDocument();
    expect(panel().queryByText("Adobe")).not.toBeInTheDocument();

    await user.click(panel().getByRole("button", { name: "Clear" }));
    expect(panel().getByText("Adobe")).toBeInTheDocument();

    await user.click(screen.getByRole("columnheader", { name: /Vendor/ }));
    expect(screen.getByLabelText("Sort by vendor")).toHaveTextContent("▼");
  });

  it("adds a generated password and copies it", async () => {
    const { user, backend } = await openPasswords();
    await user.click(screen.getByRole("button", { name: /Add Password/ }));
    expect(screen.getByText("🔑 Add Password")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add$/, hidden: false }));
    expect(window.alert).toHaveBeenCalledWith("Fill in at least one field.");

    const modal = screen.getByText("🔑 Add Password").closest(".modal-content") as HTMLElement;
    const inputs = within(modal).getAllByRole("textbox");
    await user.type(inputs[0], "Bank");
    await user.type(inputs[1], "checking");
    await user.click(within(modal).getByLabelText("14"));
    await user.click(within(modal).getByRole("button", { name: /Generate/ }));
    expect((inputs[2] as HTMLInputElement).value).toHaveLength(14);
    await user.type(inputs[3], "vault");

    fireEvent.click(within(modal).getByRole("button", { name: /Copy/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    expect(await within(modal).findByRole("button", { name: /Copied/ })).toBeInTheDocument();

    await user.click(within(modal).getByRole("button", { name: /Add$/ }));
    expect(await screen.findByText("✅ Password added")).toBeInTheDocument();
    expect(Object.values(backend.state.passwords).some((p) => p.vendor === "Bank")).toBe(true);
    expect(screen.queryByText("🔑 Add Password")).not.toBeInTheDocument();
  });

  it("closes the add modal from the overlay and cancel button", async () => {
    const { user } = await openPasswords();
    await user.click(screen.getByRole("button", { name: /Add Password/ }));
    await user.click(screen.getByRole("button", { name: "✖ Cancel" }));
    expect(screen.queryByText("🔑 Add Password")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add Password/ }));
    await user.click(screen.getByText("🔑 Add Password").closest(".modal-overlay") as HTMLElement);
    expect(screen.queryByText("🔑 Add Password")).not.toBeInTheDocument();
  });

  it("edits and deletes a password, including confirm cancel", async () => {
    const { user } = await openPasswords();
    await user.click(screen.getByText("GitHub"));
    expect(screen.getByText("🔑 Edit Password")).toBeInTheDocument();
    const modal = screen.getByText("🔑 Edit Password").closest(".modal-content") as HTMLElement;
    expect(within(modal).getAllByDisplayValue("secret1").length).toBeGreaterThan(0);
    await user.clear(within(modal).getAllByRole("textbox")[0]);
    await user.type(within(modal).getAllByRole("textbox")[0], "GitLab");
    await user.click(within(modal).getByRole("button", { name: /Update/ }));
    expect(await screen.findByText("✅ Password updated")).toBeInTheDocument();
    expect(screen.getByText("GitLab")).toBeInTheDocument();

    await user.click(screen.getByText("GitLab"));
    const editModal = screen.getByText("🔑 Edit Password").closest(".modal-content") as HTMLElement;
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    await user.click(within(editModal).getByRole("button", { name: /Delete/ }));
    expect(invoke).not.toHaveBeenCalledWith("delete_password", expect.anything());

    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    await user.click(within(editModal).getByRole("button", { name: /Delete/ }));
    expect(await screen.findByText("🗑️ Password deleted")).toBeInTheDocument();
    expect(screen.queryByText("GitLab")).not.toBeInTheDocument();
  });

  it("handles password command failures and clipboard errors", async () => {
    const { user } = await renderApp({
      fail: {
        load_passwords: "denied",
        add_password: "nope",
        update_password: "locked",
        delete_password: "busy",
      },
    });
    await openTab(user, /Passwords/);
    expect(screen.getByText("No passwords found")).toBeInTheDocument();

    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "add_password") throw "nope";
      if (cmd === "update_password") throw "locked";
      if (cmd === "delete_password") throw "busy";
      if (cmd === "load_passwords") return { p1: { vendor: "GitHub", account: "m", pw: "x", memo: "" } };
      const { createBackend } = await import("./test/backend");
      return createBackend().impl(cmd, args);
    });

    await user.click(screen.getByRole("button", { name: /Reload/ }));
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Add Password/ }));
    const addModal = screen.getByText("🔑 Add Password").closest(".modal-content") as HTMLElement;
    await user.type(within(addModal).getAllByRole("textbox")[0], "X");
    await user.click(within(addModal).getByRole("button", { name: /Add$/ }));
    expect(await screen.findByText("❌ Error: nope")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "✕" }));
    await user.click(screen.getByText("GitHub"));
    await user.click(screen.getByRole("button", { name: /Update/ }));
    expect(await screen.findByText("❌ Error: locked")).toBeInTheDocument();

    await user.click(screen.getByText("GitHub"));
    const delModal = screen.getByText("🔑 Edit Password").closest(".modal-content") as HTMLElement;
    await user.click(within(delModal).getByRole("button", { name: /Delete/ }));
    expect(await screen.findByText("❌ Error: busy")).toBeInTheDocument();

    (navigator.clipboard.writeText as jest.Mock).mockRejectedValueOnce(new Error("denied"));
    await user.click(screen.getByText("GitHub"));
    const failModal = screen.getByText("🔑 Edit Password").closest(".modal-content") as HTMLElement;
    fireEvent.click(within(failModal).getByRole("button", { name: /Copy/ }));
    expect(await screen.findByText(/Failed to copy to clipboard/)).toBeInTheDocument();
  });

  it("does nothing when copying an empty password", async () => {
    const { user } = await openPasswords();
    await user.click(screen.getByRole("button", { name: /Add Password/ }));
    const modal = screen.getByText("🔑 Add Password").closest(".modal-content") as HTMLElement;
    await user.click(within(modal).getByRole("button", { name: /Copy/ }));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("copies a password from the list without opening the editor", async () => {
    const { user } = await openPasswords();
    await user.click(screen.getByRole("button", { name: "Copy GitHub password" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("secret1"));
    expect(await screen.findByText("✅ Password copied to clipboard!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy GitHub password" })).toHaveTextContent("✅");
    expect(screen.queryByText("🔑 Edit Password")).not.toBeInTheDocument();
  });

  it("copies a password from the Copy button next to the clipboard icon", async () => {
    const { user } = await openPasswords();
    const copyBtn = screen.getByRole("button", { name: "Copy password for GitHub" });
    expect(copyBtn).toHaveTextContent("Copy");
    await user.click(copyBtn);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("secret1"));
    expect(await screen.findByText("✅ Password copied to clipboard!")).toBeInTheDocument();
    expect(copyBtn).toHaveTextContent("Copied");
    expect(screen.queryByText("🔑 Edit Password")).not.toBeInTheDocument();
  });

  it("shows a clipboard error when list copy fails", async () => {
    const { user } = await openPasswords();
    (navigator.clipboard.writeText as jest.Mock).mockRejectedValueOnce(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Copy Adobe password" }));
    expect(await screen.findByText(/Failed to copy to clipboard/)).toBeInTheDocument();
    expect(screen.queryByText("🔑 Edit Password")).not.toBeInTheDocument();
  });

  it("copies each row from the button beside the clipboard icon", async () => {
    const { user } = await openPasswords();
    const icon = screen.getByRole("button", { name: "Copy Adobe password" });
    const copy = screen.getByRole("button", { name: "Copy password for Adobe" });
    expect(icon.closest("td")).toBe(copy.closest("td"));

    await user.click(copy);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("secret2"));
    expect(copy).toHaveTextContent("Copied");
    expect(icon).toHaveTextContent("✅");
    expect(screen.getByRole("button", { name: "Copy password for GitHub" })).toHaveTextContent("Copy");
    expect(screen.getByRole("button", { name: "Copy GitHub password" })).toHaveTextContent("📋");
    expect(screen.queryByText("🔑 Edit Password")).not.toBeInTheDocument();
  });

  it("leaves blank password copy buttons disabled", async () => {
    const { user } = await renderApp({
      passwords: {
        blank: { vendor: "Blank", account: "none", pw: "", memo: "" },
      },
    });
    await openTab(user, /Passwords/);

    expect(screen.getByRole("button", { name: "Copy Blank password" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy password for Blank" })).toBeDisabled();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("shows a clipboard error when the Copy button fails", async () => {
    const { user } = await openPasswords();
    (navigator.clipboard.writeText as jest.Mock).mockRejectedValueOnce(new Error("denied"));
    const copy = screen.getByRole("button", { name: "Copy password for Adobe" });
    await user.click(copy);
    expect(await screen.findByText(/Failed to copy to clipboard/)).toBeInTheDocument();
    expect(copy).toHaveTextContent("Copy");
    expect(screen.getByRole("button", { name: "Copy Adobe password" })).toHaveTextContent("📋");
    expect(screen.queryByText("🔑 Edit Password")).not.toBeInTheDocument();
  });

  function columnHeader(key: PwColumnKey) {
    if (key === "copy") return screen.getByRole("columnheader", { name: "Copy password", exact: true });
    const label = key[0].toUpperCase() + key.slice(1);
    return screen.getByRole("columnheader", { name: new RegExp(`^${label}`) });
  }

  function dragSash(key: PwColumnKey, deltaX: number) {
    const sash = within(columnHeader(key)).getByRole("separator", { name: `Resize ${key} column` });
    fireEvent.mouseDown(sash, { clientX: 0 });
    fireEvent.mouseMove(window, { clientX: deltaX });
    return sash;
  }

  it("restores every saved column width and clamps out-of-range values", async () => {
    localStorage.setItem(
      PW_COLUMN_STORAGE_KEY,
      JSON.stringify({
        copy: 10,
        vendor: 300,
        account: 210,
        password: 5000,
        memo: 400,
      }),
    );
    await openPasswords();

    expect(columnHeader("copy")).toHaveStyle({ width: `${PW_COLUMN_MIN.copy}px` });
    expect(columnHeader("vendor")).toHaveStyle({ width: "300px" });
    expect(columnHeader("account")).toHaveStyle({ width: "210px" });
    expect(columnHeader("password")).toHaveStyle({ width: `${PW_COLUMN_MAX}px` });
    expect(columnHeader("memo")).toHaveStyle({ width: "400px" });
  });

  it("resizes every password column from its sash without moving the others", async () => {
    await openPasswords();
    for (const key of PW_COLUMN_KEYS) {
      expect(screen.getByRole("separator", { name: `Resize ${key} column` })).toBeInTheDocument();
    }

    const accountSash = dragSash("account", 50);
    expect(accountSash).toHaveClass("is-resizing");
    expect(columnHeader("account")).toHaveStyle({ width: `${PW_COLUMN_DEFAULTS.account + 50}px` });
    expect(columnHeader("vendor")).toHaveStyle({ width: `${PW_COLUMN_DEFAULTS.vendor}px` });
    fireEvent.mouseUp(window);
    expect(accountSash).not.toHaveClass("is-resizing");

    dragSash("copy", -100);
    expect(columnHeader("copy")).toHaveStyle({ width: `${PW_COLUMN_MIN.copy}px` });
    expect(columnHeader("account")).toHaveStyle({ width: `${PW_COLUMN_DEFAULTS.account + 50}px` });
    fireEvent.mouseUp(window);

    dragSash("password", 1000);
    expect(columnHeader("password")).toHaveStyle({ width: `${PW_COLUMN_MAX}px` });
    fireEvent.mouseUp(window);

    dragSash("memo", 30);
    expect(columnHeader("memo")).toHaveStyle({ width: `${PW_COLUMN_DEFAULTS.memo + 30}px` });
    fireEvent.mouseUp(window);

    expect(JSON.parse(localStorage.getItem(PW_COLUMN_STORAGE_KEY) || "{}")).toEqual({
      copy: PW_COLUMN_MIN.copy,
      vendor: PW_COLUMN_DEFAULTS.vendor,
      account: PW_COLUMN_DEFAULTS.account + 50,
      password: PW_COLUMN_MAX,
      memo: PW_COLUMN_DEFAULTS.memo + 30,
    });
  });

  it("resizes a password column with the sash and remembers the width", async () => {
    const first = await openPasswords();
    const vendorHeader = () => screen.getByRole("columnheader", { name: /Vendor/ });
    expect(vendorHeader()).toHaveStyle({ width: `${PW_COLUMN_DEFAULTS.vendor}px` });
    expect(screen.getByLabelText("Sort by vendor")).toHaveTextContent("▲");

    const sash = within(vendorHeader()).getByRole("separator", { name: "Resize vendor column" });
    fireEvent.click(sash);
    expect(screen.getByLabelText("Sort by vendor")).toHaveTextContent("▲");

    fireEvent.mouseDown(sash, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: -40 });
    expect(vendorHeader()).toHaveStyle({ width: `${PW_COLUMN_MIN.vendor}px` });
    fireEvent.mouseMove(window, { clientX: 160 });
    expect(vendorHeader()).toHaveStyle({ width: "240px" });
    fireEvent.mouseUp(window);

    expect(JSON.parse(localStorage.getItem(PW_COLUMN_STORAGE_KEY) || "{}").vendor).toBe(240);
    first.unmount();

    await openPasswords();
    expect(screen.getByRole("columnheader", { name: /Vendor/ })).toHaveStyle({ width: "240px" });
  });
});

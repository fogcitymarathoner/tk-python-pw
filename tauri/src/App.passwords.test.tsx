import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "./test/mocks/tauri";
import { activePanel, openTab, renderApp } from "./test/renderApp";

describe("Passwords tab", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(await screen.findByText(/Failed to copy to clipboard/)).toBeInTheDocument();
  });

  it("does nothing when copying an empty password", async () => {
    const { user } = await openPasswords();
    await user.click(screen.getByRole("button", { name: /Add Password/ }));
    await user.click(screen.getByRole("button", { name: /Copy/ }));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});

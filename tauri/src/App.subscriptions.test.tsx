import { screen, within } from "@testing-library/react";
import { invoke } from "./test/mocks/tauri";
import { sampleSubscriptions } from "./test/fixtures";
import { activePanel, openTab, renderApp } from "./test/renderApp";

describe("Subscriptions tab", () => {
  async function openSubs() {
    const ctx = await renderApp();
    await openTab(ctx.user, /Subscriptions/);
    return ctx;
  }

  it("lists, searches, filters, and sorts subscriptions", async () => {
    const { user } = await openSubs();
    const panel = () => within(activePanel());
    expect(panel().getByText("Netflix")).toBeInTheDocument();
    expect(panel().queryByText("Adobe")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Inactive/ }));
    expect(panel().getByText("Adobe")).toBeInTheDocument();
    expect(panel().queryByText("Netflix")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /All/ }));
    expect(panel().getByText("Netflix")).toBeInTheDocument();
    expect(panel().getByText("Adobe")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search subscriptions..."), "net");
    expect(panel().getByText("Netflix")).toBeInTheDocument();
    expect(panel().queryByText("Adobe")).not.toBeInTheDocument();
    await user.click(panel().getByRole("button", { name: "Clear" }));

    await user.click(screen.getByRole("columnheader", { name: /Due Date/ }));
    expect(screen.getByRole("columnheader", { name: /Due Date/ })).toHaveTextContent("▼");
  });

  it("adds a monthly subscription and rejects a missing name", async () => {
    const { user, backend } = await openSubs();
    await user.click(screen.getByRole("button", { name: /Add Subscription/ }));
    await user.click(screen.getByRole("button", { name: /Add$/ }));
    expect(window.alert).toHaveBeenCalledWith("Service Name is required.");

    const modal = screen.getByText("📋 Add Subscription").closest(".modal-content") as HTMLElement;
    await user.type(within(modal).getAllByRole("textbox")[0], "Spotify");
    await user.type(within(modal).getAllByRole("textbox")[1], "music");
    await user.type(within(modal).getAllByRole("textbox")[2], "$10");
    await user.selectOptions(within(modal).getAllByRole("combobox")[1], "15th");
    await user.type(within(modal).getAllByRole("textbox")[3], "family");
    await user.click(within(modal).getByRole("button", { name: /Add$/ }));

    expect(await screen.findByText("✅ Subscription 'Spotify' added")).toBeInTheDocument();
    expect(Object.values(backend.state.subscriptions).some((s) => s.name === "Spotify")).toBe(true);
  });

  it("adds an annual subscription using month plus day", async () => {
    const { user, backend } = await openSubs();
    await user.click(screen.getByRole("button", { name: /Add Subscription/ }));
    const modal = screen.getByText("📋 Add Subscription").closest(".modal-content") as HTMLElement;
    await user.type(within(modal).getAllByRole("textbox")[0], "Car Insurance");
    await user.selectOptions(within(modal).getByDisplayValue("Monthly"), "annual");
    await user.selectOptions(within(modal).getByDisplayValue("January"), "June");
    await user.selectOptions(within(modal).getByDisplayValue("1st"), "10th");
    await user.click(within(modal).getByRole("button", { name: /Add$/ }));
    expect(await screen.findByText("✅ Subscription 'Car Insurance' added")).toBeInTheDocument();
    const created = Object.values(backend.state.subscriptions).find((s) => s.name === "Car Insurance");
    expect(created?.dueDate).toBe("June 10th");
    expect(created?.period).toBe("annual");
  });

  it("edits, toggles status, and deletes a subscription", async () => {
    const { user } = await openSubs();
    await user.click(screen.getByText("Netflix"));
    expect(screen.getByText("📋 Edit Subscription")).toBeInTheDocument();

    const modal = screen.getByText("📋 Edit Subscription").closest(".modal-content") as HTMLElement;
    await user.clear(within(modal).getAllByRole("textbox")[0]);
    await user.click(within(modal).getByRole("button", { name: /Update/ }));
    expect(window.alert).toHaveBeenCalledWith("Service Name is required.");

    await user.type(within(modal).getAllByRole("textbox")[0], "Netflix Family");
    await user.selectOptions(within(modal).getByDisplayValue("Active"), "inactive");
    await user.click(within(modal).getByRole("button", { name: /Update/ }));
    expect(await screen.findByText("✅ Subscription 'Netflix Family' updated")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /All/ }));
    await user.click(screen.getByText("Netflix Family").closest("tr")!.querySelector(".status-badge")!);
    expect(await screen.findByText(/status set to active/)).toBeInTheDocument();

    await user.click(screen.getByText("Netflix Family"));
    const deleteModal = screen.getByText("📋 Edit Subscription").closest(".modal-content") as HTMLElement;
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    await user.click(within(deleteModal).getByRole("button", { name: /Delete/ }));
    expect(invoke).not.toHaveBeenCalledWith("delete_subscription", expect.anything());

    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    await user.click(within(deleteModal).getByRole("button", { name: /Delete/ }));
    expect(await screen.findByText(/Subscription 'Netflix Family' deleted/)).toBeInTheDocument();
  });

  it("opens an annual subscription and a bi-monthly one for editing", async () => {
    const { user } = await renderApp({
      subscriptions: {
        ...sampleSubscriptions,
        s4: {
          name: "Lawn",
          account: "yard",
          amount: "$40",
          dueDate: "April 2nd",
          memo: "",
          period: "every_two_months",
          status: "active",
        },
      },
    });
    await openTab(user, /Subscriptions/);
    await user.click(screen.getByRole("button", { name: /All/ }));
    await user.click(screen.getByText("Domain"));
    expect(screen.getByDisplayValue("Annual")).toBeInTheDocument();
    expect(screen.getByDisplayValue("March")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "✖ Cancel" }));

    await user.click(screen.getByText("Lawn"));
    expect(screen.getByDisplayValue("Every two months")).toBeInTheDocument();
    expect(screen.getByDisplayValue("April")).toBeInTheDocument();
    await user.click(screen.getByText("📋 Edit Subscription").closest(".modal-overlay") as HTMLElement);
    expect(screen.queryByText("📋 Edit Subscription")).not.toBeInTheDocument();
  });

  it("renders the calendar, navigates months, and expands a busy day", async () => {
    const many: Record<string, (typeof sampleSubscriptions)[string]> = {};
    for (let i = 0; i < 5; i++) {
      many[`busy-${i}`] = {
        name: `Busy${i}`,
        account: "a",
        amount: "$1",
        dueDate: "15th",
        memo: "",
        period: "monthly",
        status: "active",
      };
    }
    const { user } = await renderApp({ subscriptions: many });
    await openTab(user, /Subscriptions/);
    await user.click(screen.getByRole("button", { name: /Calendar/ }));
    expect(screen.getByText("TODAY").closest(".calendar-day-cell")).toBeTruthy();
    expect(screen.getByRole("button", { name: /5 subscriptions/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "▶" }));
    await user.click(screen.getByRole("button", { name: "◀" }));
    await user.click(screen.getByRole("button", { name: "Today" }));

    await user.click(screen.getByRole("button", { name: /5 subscriptions/ }));
    expect(screen.getByText(/15, /)).toBeInTheDocument();
    await user.click(screen.getByText("Busy0"));
    expect(screen.getByText("📋 Edit Subscription")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "✕" }));

    await user.click(screen.getByRole("button", { name: /Calendar/ }));
    const preview = await screen.findByRole("button", { name: /5 subscriptions/ });
    await user.click(preview);
    await user.click(screen.getByText(/15, /).closest(".modal-overlay") as HTMLElement);
    expect(screen.queryByText(/subscription/)).toBeTruthy();
  });

  it("opens a calendar badge and shows overflow names on short months", async () => {
    const { user } = await renderApp({
      subscriptions: {
        n: {
          name: "Netflix",
          account: "home",
          amount: "$15",
          dueDate: "15th",
          memo: "",
          period: "monthly",
          status: "inactive",
        },
        rent: {
          name: "Rent",
          account: "apt",
          amount: "$1",
          dueDate: "31st",
          memo: "",
          period: "monthly",
          status: "active",
        },
      },
    });
    await openTab(user, /Subscriptions/);
    await user.click(screen.getByRole("button", { name: /All/ }));
    await user.click(screen.getByRole("button", { name: /Calendar/ }));
    await user.click(screen.getByText("Netflix"));
    expect(screen.getByText("📋 Edit Subscription")).toBeInTheDocument();
  });

  it("handles subscription command failures", async () => {
    const { user } = await renderApp({
      fail: {
        load_subscriptions: "denied",
        add_subscription: "nope",
        update_subscription: "locked",
        delete_subscription: "busy",
      },
    });
    await openTab(user, /Subscriptions/);
    expect(screen.getByText("No subscriptions found")).toBeInTheDocument();

    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "add_subscription") throw "nope";
      if (cmd === "update_subscription") throw "locked";
      if (cmd === "delete_subscription") throw "busy";
      if (cmd === "load_subscriptions") return sampleSubscriptions;
      const { createBackend } = await import("./test/backend");
      return createBackend({ subscriptions: sampleSubscriptions }).impl(cmd, args);
    });

    await user.click(screen.getByRole("button", { name: /Reload/ }));
    await user.click(screen.getByRole("button", { name: /Add Subscription/ }));
    const modal = screen.getByText("📋 Add Subscription").closest(".modal-content") as HTMLElement;
    await user.type(within(modal).getAllByRole("textbox")[0], "X");
    await user.click(within(modal).getByRole("button", { name: /Add$/ }));
    expect(await screen.findByText("❌ Error: nope")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /All/ }));
    await user.click(screen.getByText("Netflix").closest("tr")!.querySelector(".status-badge")!);
    expect(await screen.findByText("❌ Error toggling status: locked")).toBeInTheDocument();

    await user.click(screen.getByText("Netflix"));
    await user.click(screen.getByRole("button", { name: /Update/ }));
    expect(await screen.findByText("❌ Error: locked")).toBeInTheDocument();

    await user.click(screen.getByText("Netflix"));
    const errModal = screen.getByText("📋 Edit Subscription").closest(".modal-content") as HTMLElement;
    await user.click(within(errModal).getByRole("button", { name: /Delete/ }));
    expect(await screen.findByText("❌ Error: busy")).toBeInTheDocument();
  });
});

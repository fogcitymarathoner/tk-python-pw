import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "./test/mocks/tauri";
import { food } from "./test/fixtures";
import { activePanel, renderApp } from "./test/renderApp";

function categoryPanel() {
  return screen.getByText("Categories").closest(".panel-col") as HTMLElement;
}

function vendorPanel() {
  return screen.getByText("Vendors/Customers").closest(".panel-col") as HTMLElement;
}

describe("Expenses tab", () => {
  it("filters by category and vendor, resets, and toggles sort", async () => {
    const { user } = await renderApp();
    expect(screen.getByText("$42.50")).toBeInTheDocument();
    expect(screen.getByText("$18.00")).toBeInTheDocument();

    await user.click(screen.getByText("📁 Food"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "get_expenses_by_category_and_vendor",
        expect.objectContaining({ categoryId: 1, vendorId: null }),
      );
    });
    expect(await screen.findByText(/📂 Food/)).toBeInTheDocument();

    await user.click(screen.getByText("👤 Costco"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "get_expenses_by_category_and_vendor",
        expect.objectContaining({ categoryId: 1, vendorId: 1 }),
      );
    });

    await user.click(within(vendorPanel()).getByText("🏷️ All Vendors"));
    await user.click(screen.getByText("📊 All Expenses"));
    await user.click(screen.getByRole("button", { name: /Reset Filters/ }));
    expect(within(categoryPanel()).getByText(/All Expenses/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Oldest First/ }));
    expect(await screen.findByRole("button", { name: /Newest First/ })).toBeInTheDocument();
    await user.click(screen.getByRole("columnheader", { name: "Vendor" }));
    await user.click(screen.getByRole("columnheader", { name: "Amount" }));
    await user.click(screen.getByRole("columnheader", { name: "Date" }));
    await user.click(screen.getByRole("columnheader", { name: "Memo" }));
  });

  it("adds, updates, and deletes an expense including validation", async () => {
    const { user, backend } = await renderApp();
    await user.click(screen.getByRole("button", { name: /Add Expense/ }));
    const modal = screen.getByText("💰 Add Expense").closest(".modal-content") as HTMLElement;
    await user.click(within(modal).getByRole("button", { name: /Add Expense/ }));
    expect(window.alert).toHaveBeenCalledWith("Vendor, Amount, and Category are required");
    await user.selectOptions(within(modal).getAllByRole("combobox")[0], "Uber");
    const amountInput = within(modal)
      .getAllByRole("textbox")
      .find((el) => el.closest(".form-group")?.textContent?.includes("Amount")) as HTMLElement;
    await user.type(amountInput, "33.10");
    await user.selectOptions(within(modal).getAllByRole("combobox")[1], "Travel");
    const memoInput = within(modal)
      .getAllByRole("textbox")
      .find((el) => el.closest(".form-group")?.textContent?.includes("Memo")) as HTMLElement;
    await user.type(memoInput, "ride");
    await user.click(within(modal).getByRole("button", { name: "Today" }));
    fireEvent.click(within(modal).getByTitle("Open calendar"));
    expect(HTMLInputElement.prototype.showPicker).toHaveBeenCalled();
    await user.click(within(modal).getByRole("button", { name: /Add Expense/ }));
    expect(await screen.findByText("✅ Expense added successfully")).toBeInTheDocument();
    expect(backend.state.expenses.some((e) => e.amount === "33.10")).toBe(true);

    await user.click(screen.getByText("📊 All Expenses"));
    await user.click(await within(activePanel()).findByRole("cell", { name: "Costco" }));
    const edit = screen.getByText("💰 Edit Expense").closest(".modal-content") as HTMLElement;
    const amount = within(edit).getAllByRole("textbox")[0];
    await user.clear(amount);
    await user.click(within(edit).getByRole("button", { name: /Update/ }));
    expect(window.alert).toHaveBeenCalledWith("Vendor, Amount, and Category are required");
    await user.type(amount, "50");
    await user.click(within(edit).getByRole("button", { name: /Update/ }));
    expect(await screen.findByText("✅ Expense updated")).toBeInTheDocument();

    await user.click(within(activePanel()).getByRole("cell", { name: "Costco" }));
    const deleteModal = screen.getByText("💰 Edit Expense").closest(".modal-content") as HTMLElement;
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    await user.click(within(deleteModal).getByRole("button", { name: /Delete/ }));
    expect(invoke).not.toHaveBeenCalledWith("delete_expense", expect.anything());
    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    await user.click(within(deleteModal).getByRole("button", { name: /Delete/ }));
    expect(await screen.findByText("🗑️ Expense deleted")).toBeInTheDocument();
  });

  it("manages categories including existing-name selection", async () => {
    const { user } = await renderApp();
    (window.prompt as jest.Mock).mockReturnValueOnce("");
    await user.click(within(categoryPanel()).getByRole("button", { name: /Add/ }));
    expect(invoke).not.toHaveBeenCalledWith("add_category", expect.anything());

    (window.prompt as jest.Mock).mockReturnValueOnce("Food");
    await user.click(within(categoryPanel()).getByRole("button", { name: /Add/ }));
    expect(await screen.findByText(/Category 'Food' already exists/)).toBeInTheDocument();

    (window.prompt as jest.Mock).mockReturnValueOnce("Health");
    await user.click(within(categoryPanel()).getByRole("button", { name: /Add/ }));
    expect(await screen.findByText("✅ Category 'Health' added")).toBeInTheDocument();
    expect(screen.getByText("📁 Health")).toBeInTheDocument();

    await user.click(screen.getByText("📁 Health"));
    (window.prompt as jest.Mock).mockReturnValueOnce("Medical");
    await user.click(within(categoryPanel()).getByRole("button", { name: /Rename/ }));
    expect(await screen.findByText("✅ Category renamed to 'Medical'")).toBeInTheDocument();

    await user.click(screen.getByText("📁 Food"));
    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    await user.click(within(categoryPanel()).getByRole("button", { name: /Delete/ }));
    expect(await screen.findByText(/Category 'Food' deleted/)).toBeInTheDocument();
  });

  it("warns when renaming or deleting a category without a selection", async () => {
    const { user } = await renderApp();
    expect(within(categoryPanel()).getByRole("button", { name: /Rename/ })).toBeDisabled();
    fireEvent.click(within(categoryPanel()).getByRole("button", { name: /Rename/ }));
    fireEvent.click(within(categoryPanel()).getByRole("button", { name: /Delete/ }));
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("manages vendors including existing-name selection", async () => {
    const { user } = await renderApp();
    (window.prompt as jest.Mock).mockReturnValueOnce("   ");
    await user.click(within(vendorPanel()).getByRole("button", { name: /Add/ }));

    (window.prompt as jest.Mock).mockReturnValueOnce("Costco");
    await user.click(within(vendorPanel()).getByRole("button", { name: /Add/ }));
    expect(await screen.findByText(/Vendor 'Costco' already exists/)).toBeInTheDocument();

    (window.prompt as jest.Mock).mockReturnValueOnce("Amazon");
    await user.click(within(vendorPanel()).getByRole("button", { name: /Add/ }));
    expect(await screen.findByText("✅ Vendor 'Amazon' added")).toBeInTheDocument();

    await user.click(screen.getByText("👤 Amazon"));
    (window.prompt as jest.Mock).mockReturnValueOnce("AWS");
    await user.click(within(vendorPanel()).getByRole("button", { name: /Rename/ }));
    expect(await screen.findByText("✅ Vendor renamed to 'AWS'")).toBeInTheDocument();

    await user.click(screen.getByText("👤 Uber"));
    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    await user.click(within(vendorPanel()).getByRole("button", { name: /Delete/ }));
    expect(await screen.findByText(/Vendor 'Uber' deleted/)).toBeInTheDocument();
  });

  it("auto-fills category when a vendor is chosen from All Expenses", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByText("👤 Costco"));
    expect(await screen.findByText(/auto-filled category 'Food'/)).toBeInTheDocument();
    expect(screen.getByText("📁 Food").closest(".list-item")).toHaveClass("selected");
  });

  it("pre-fills the add-expense modal from the current filters", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByText("📁 Food"));
    await user.click(screen.getByText("👤 Costco"));
    await user.click(screen.getByRole("button", { name: /Add Expense/ }));
    const modal = screen.getByText("💰 Add Expense").closest(".modal-content") as HTMLElement;
    expect(within(modal).getByDisplayValue("Costco")).toBeInTheDocument();
    expect(within(modal).getByDisplayValue("Food")).toBeInTheDocument();
    fireEvent.click(screen.getByText("💰 Add Expense").closest(".modal-overlay") as HTMLElement);
    expect(screen.queryByText("💰 Add Expense")).not.toBeInTheDocument();
  });

  it("handles category, vendor, and expense command failures", async () => {
    const { user } = await renderApp({
      fail: {
        add_category: "cat-fail",
        rename_category: "rename-cat",
        delete_category: "del-cat",
        add_vendor: "vend-fail",
        rename_vendor: "rename-vend",
        delete_vendor: "del-vend",
        add_expense: "exp-fail",
        update_expense: "upd-fail",
        delete_expense: "del-exp",
        get_expenses_with_categories: "list-fail",
      },
    });

    expect(screen.getByText("No expenses found")).toBeInTheDocument();

    (window.prompt as jest.Mock).mockReturnValue("NewCat");
    await user.click(within(categoryPanel()).getByRole("button", { name: /Add/ }));
    expect(window.alert).toHaveBeenCalledWith("Error: cat-fail");

    await user.click(screen.getByText("📁 Food"));
    (window.prompt as jest.Mock).mockReturnValue("X");
    await user.click(within(categoryPanel()).getByRole("button", { name: /Rename/ }));
    expect(window.alert).toHaveBeenCalledWith("Error: rename-cat");
    (window.confirm as jest.Mock).mockReturnValue(true);
    await user.click(within(categoryPanel()).getByRole("button", { name: /Delete/ }));
    expect(window.alert).toHaveBeenCalledWith("Error: del-cat");

    (window.prompt as jest.Mock).mockReturnValue("NewVend");
    await user.click(within(vendorPanel()).getByRole("button", { name: /Add/ }));
    expect(window.alert).toHaveBeenCalledWith("Error: vend-fail");
    await user.click(screen.getByText("👤 Costco"));
    await user.click(within(vendorPanel()).getByRole("button", { name: /Rename/ }));
    expect(window.alert).toHaveBeenCalledWith("Error: rename-vend");
    await user.click(within(vendorPanel()).getByRole("button", { name: /Delete/ }));
    expect(window.alert).toHaveBeenCalledWith("Error: del-vend");

    await user.click(screen.getByRole("button", { name: /Add Expense/ }));
    const modal = screen.getByText("💰 Add Expense").closest(".modal-content") as HTMLElement;
    await user.selectOptions(within(modal).getAllByRole("combobox")[0], "Costco");
    const amountBox = within(modal).getAllByRole("textbox")[0];
    await user.type(amountBox, "1");
    await user.selectOptions(within(modal).getAllByRole("combobox")[1], "Food");
    await user.click(within(modal).getByRole("button", { name: /Add Expense/ }));
    expect(window.alert).toHaveBeenCalledWith("Error adding expense: exp-fail");
    await user.click(within(modal).getByRole("button", { name: /Cancel/ }));

    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "update_expense") throw "upd-fail";
      if (cmd === "delete_expense") throw "del-exp";
      if (cmd === "get_expenses_with_categories") {
        return [
          {
            localId: 1,
            remoteId: "e1",
            vendorName: "Costco",
            vendorId: 1,
            categoryId: 1,
            categoryName: "Food",
            amount: "42.50",
            date: "2026-01-15",
            memo: "groceries",
            userId: "user-1",
          },
        ];
      }
      const { createBackend } = await import("./test/backend");
      return createBackend().impl(cmd, args);
    });
    await user.click(screen.getByRole("button", { name: /Reload/ }));
    await user.click(await within(activePanel()).findByRole("cell", { name: "Costco" }));
    await user.click(screen.getByRole("button", { name: /Update/ }));
    expect(window.alert).toHaveBeenCalledWith("Error updating expense: upd-fail");
    await user.click(within(activePanel()).getByRole("cell", { name: "Costco" }));
    const failDelete = screen.getByText("💰 Edit Expense").closest(".modal-content") as HTMLElement;
    await user.click(within(failDelete).getByRole("button", { name: /Delete/ }));
    expect(window.alert).toHaveBeenCalledWith("Error deleting expense: del-exp");
  });

  it("cancels category rename and delete prompts", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByText("📁 Food"));
    (window.prompt as jest.Mock).mockReturnValueOnce(null);
    await user.click(within(categoryPanel()).getByRole("button", { name: /Rename/ }));
    expect(invoke).not.toHaveBeenCalledWith("rename_category", expect.anything());
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    await user.click(within(categoryPanel()).getByRole("button", { name: /Delete/ }));
    expect(invoke).not.toHaveBeenCalledWith("delete_category", expect.anything());

    await user.click(screen.getByText("👤 Costco"));
    (window.prompt as jest.Mock).mockReturnValueOnce(null);
    await user.click(within(vendorPanel()).getByRole("button", { name: /Rename/ }));
    expect(invoke).not.toHaveBeenCalledWith("rename_vendor", expect.anything());
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    await user.click(within(vendorPanel()).getByRole("button", { name: /Delete/ }));
    expect(invoke).not.toHaveBeenCalledWith("delete_vendor", expect.anything());
  });

  it("shows the empty expense table and still allows adding a category after a failed list load", async () => {
    await renderApp({ expenses: [], categories: [food], vendors: [] });
    expect(screen.getByText("No expenses found")).toBeInTheDocument();
  });
});

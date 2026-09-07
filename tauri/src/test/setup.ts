import "@testing-library/jest-dom";
import { invoke } from "./mocks/tauri";

if (!navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: jest.fn().mockResolvedValue(undefined),
    },
  });
}

const tabStyles = document.createElement("style");
tabStyles.textContent = `
  .tab-panel { display: none !important; }
  .tab-panel.active { display: flex !important; }
`;
document.head.appendChild(tabStyles);

Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
  configurable: true,
  value: jest.fn(),
});

beforeEach(() => {
  invoke.mockReset();
  jest.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  window.prompt = jest.fn();
  (HTMLInputElement.prototype.showPicker as jest.Mock).mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

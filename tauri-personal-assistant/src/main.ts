import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import wikiIcon from "./assets/icons/wiki.ico";
import personalDataIcon from "./assets/icons/personal-data.png";
import gmailFilterIcon from "./assets/icons/gmail-filter.png";
import { mountApp } from "./lib/app";

const APP_ICONS: Record<string, string> = {
  wiki: wikiIcon,
  "personal-data": personalDataIcon,
  "gmail-filter": gmailFilterIcon,
};

window.addEventListener("DOMContentLoaded", () => {
  mountApp({
    invoke: (cmd, args) => invoke(cmd, args),
    openUrl,
    icons: APP_ICONS,
  });
});

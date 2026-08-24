# Gmail Filters XML Editor

Gmail can export and import its filters using XML formatting.  Using a custom XML editor like this is a better way of managing and creating more complicated filters.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Build
### For exe binary
```npm run tauri build -- --target x86_64-pc-windows-msvc```
Builds here **.\src-tauri\target\x86_64-pc-windows-msvc\release\gmail-filter-editor.exe**
Find your installer in src-tauri/target/release/bundle/
### For web deploy (dist)
Run **np run tauri:build** (or cargo tauri build)

## Desktop Dev Server (with watchdog)
``` npm run tauri:dev```
## Load and Go
```

   1. Open a new terminal and run:
   1    npm run tauri build
   2. Once the build is complete, Tauri will generate a highly optimized, tiny standalone Windows executable
      (tauri-app.exe) and an installer for you!
   3. You can find your standalone desktop executable inside:
     C:\Users\marc\Documents\repos\firebase_pw\tauri-email-filters\src-tauri\target\release\
     ```


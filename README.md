# AFO Image Updater

A Figma plugin + local server that automatically replaces image layers in your Figma file with the latest versions from your local hard drive (e.g. a Perforce workspace).

Instead of manually re-uploading images one by one, you point the plugin at a root folder, select the projects you want to sync, and it matches Figma layer names to filenames on disk — updating every matched image in one click.

---

## How it works

```
Figma Plugin (ui.html + code.ts)
        │
        │  HTTP requests to localhost:3000
        ▼
Local Server (Express.js)
        │
        │  Reads files from disk
        ▼
Your local filesystem (Perforce workspace, NAS, etc.)
```

The plugin talks to a local Express server running on `127.0.0.1:3000`. The server scans your filesystem for image files matching the names of your Figma image layers, and returns them as base64 data. The plugin then replaces the fills in Figma.

**Matching logic:** A Figma layer named `hero-banner` will match any file called `hero-banner.png`, `hero-banner.jpg`, `hero-banner.webp`, etc., found within the selected project folders. If multiple files with the same name exist across subfolders, the newest one (by modification time) wins.

---

## Components

| Component | Location | Purpose |
|---|---|---|
| Figma plugin | `HDD Updater/` | The panel that runs inside Figma |
| Electron app | `electron-app/` | Menu bar app — recommended for teams |
| Standalone server | `server.js` | Simple server — for solo use or testing |

The Electron app and the standalone server both expose the same API on `:3000`. The Electron app adds token-based authentication and runs automatically at login.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- Figma desktop app (the plugin requires local network access, which is not available in the browser version)

### Option A — Electron Menu Bar App (Recommended for Teams)

The Electron app runs as a macOS/Windows menu bar icon. It starts the server automatically, manages a security token, and can be set to launch at login.

**First-time setup:**

1. Download or build the app (see [Building from Source](#building-from-source))
2. Open **AFO Image Updater** — the server starts automatically
3. Click the menu bar icon → **Show Setup Token** → the token is copied to your clipboard
4. Open Figma → run the **AFO Image Updater** plugin → click the gear icon → paste the token into **Security Token** → **Save & Connect**

Each team member does this once. The token is stored per-user inside Figma's plugin storage.

### Option B — Standalone Server (No token required)

For local testing or solo use:

```bash
# Install dependencies (one-time)
npm install

# Start the server
node server.js
```

The server runs on `http://localhost:3000`. Leave the **Security Token** field blank in the plugin settings.

To make startup easier on macOS, double-click `start_server.command` in the project root.

**Auto-start on login (macOS):**

1. Go to **System Settings → General → Login Items**
2. Click the **(+)** button
3. Select `start_server.command` from the tool folder

The server will now launch automatically on every login.

<details>
<summary>To remove auto-start</summary>

1. Go to **System Settings → General → Login Items**
2. Find **start_server.command** in the list
3. Select it and click the **(–)** button

The server will no longer launch automatically. You can still start it manually by double-clicking `start_server.command`.

</details>

---

## Plugin Setup

1. In Figma desktop, go to **Plugins → Development → Import plugin from manifest…**
2. Select `HDD Updater/manifest.json`
3. Run the plugin from **Plugins → Development → AFO Image Updater**
4. Click the gear icon and configure:

| Setting | Description |
|---|---|
| **Projects Root Folder** | Full path to your main projects folder (e.g. `/Users/name/Perforce/workspace/`) |
| **Ignored Folders** | Comma-separated folder names to skip (e.g. `Animation, Marketing, Video`) |
| **Highlight Color** | Border color applied to layers that were just updated |
| **Security Token** | Paste from the Electron app's "Show Setup Token" menu. Leave blank for standalone server. |

**Mac tip for the path:** In Finder, right-click your projects folder → hold Option → **Copy as Pathname**, then paste it in.

---

## Using the Plugin

### Syncing all images on the page

1. Make sure no image layers are selected in Figma
2. Check one or more project folders in the plugin panel
3. Click **Sync All Page Images**

The plugin scans every image-fill layer on the current page, matches names to files in the selected folders, and replaces them.

### Syncing selected images only

1. Select one or more image layers in Figma (directly on the canvas)
2. The sync button changes to **Sync (N) images** and turns purple
3. Check the relevant project folder(s) in the panel
4. Click **Sync (N) images**

Only the selected layers are updated — even if other layers on the page share the same name, they are not touched.

### Highlight updated layers

The **Highlight updated layers** toggle (in the footer) adds a colored border to every layer that was just updated, so you can see at a glance what changed. The color is configurable in Settings.

Highlights persist until the next sync, and can be toggled on/off without re-syncing.

---

## Security

The Electron app enforces a token on every request. The token is:

- Generated as a 64-character random hex string on first launch
- Stored encrypted using macOS Keychain / Windows DPAPI (`safeStorage`)
- Compared using constant-time comparison to prevent timing attacks
- Automatically cleared from the environment after the server process loads it

The server binds to `127.0.0.1` only — it is never reachable from the network.

**To regenerate the token** (e.g. if a team member leaves): menu bar icon → **Regenerate Token…** → the app restarts with a new token. All team members will need to paste the new token into their plugin settings.

---

## Building from Source

### Electron App (macOS)

```bash
cd electron-app
npm install
npm run build:mac
```

Output: `electron-app/dist/AFO Image Updater-1.0.0-arm64.dmg`

> **Note:** The build is unsigned. On first launch, macOS will block it. Right-click the app → **Open**, then click **Open** in the dialog. Or go to **System Settings → Privacy & Security → Open Anyway**. To distribute without this warning, a paid Apple Developer account and code signing are required.

### Windows

```bash
cd electron-app
npm install
npm run build:win
```

### Figma Plugin (TypeScript)

The plugin is written in TypeScript. After making changes to `HDD Updater/code.ts`, recompile:

```bash
cd "HDD Updater"
npm install
npm run build
```

This produces `code.js`, which Figma loads.

---

## Project Structure

```
/
├── HDD Updater/            Figma plugin
│   ├── code.ts             Plugin logic (TypeScript source)
│   ├── code.js             Compiled output — loaded by Figma
│   ├── ui.html             Plugin panel UI (HTML + CSS + JS, all in one file)
│   └── manifest.json       Figma plugin manifest
│
├── electron-app/           Menu bar desktop application
│   ├── main.js             Electron main process — tray, token, server orchestration
│   ├── server.js           Express server (token auth always enforced)
│   ├── assets/
│   │   ├── tray-icon.png   16×16 menu bar icon
│   │   └── icon.icns       macOS app icon (required for builds)
│   └── build/
│       └── entitlements.mac.plist
│
├── server.js               Standalone server (token auth optional)
├── start_server.command    macOS double-click shortcut to start standalone server
└── tests/                  Local test environments with sample folder structures
```

---

## Troubleshooting

**"Token missing or wrong" in the plugin**
The server is running but the token doesn't match. Open the plugin Settings (gear icon) and paste the current token from the Electron app's **Show Setup Token** menu.

**"Cannot reach server"**
The server is not running. Either open the AFO Image Updater menu bar app, or run `node server.js` in the project root.

**No images updated after sync**
- Check that the layer names in Figma exactly match the filenames on disk (case-insensitive, without extension)
- Make sure the correct project folders are checked in the plugin panel
- Verify the root path in Settings points to the right directory
- Check that the file type is supported: PNG, JPG, JPEG, WEBP

**Figma shows a network error**
The plugin only works in the **Figma desktop app**. The browser version of Figma blocks local network requests.

---

## Development Notes

- The Figma plugin uses `documentAccess: dynamic-page` in the manifest, which requires `figma.getNodeByIdAsync()` (not the synchronous `getNodeById`)
- `getPluginData()` is never called inside `findAll()` callbacks — this would be called on every node and severely degrades performance on large files
- The standalone `server.js` and `electron-app/server.js` are intentionally kept as separate files — the Electron version always enforces token auth, while the root version makes it optional

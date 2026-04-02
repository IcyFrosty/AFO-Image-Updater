/**
 * AFO Image Updater — Electron main process
 *
 * Setup flow for new team members:
 *   1. Open the app — it auto-starts the server.
 *   2. Click the tray icon → "Show Setup Token" → Copy.
 *   3. Open the Figma plugin → Settings → paste the token → Save & Connect.
 *   Done. The token is stored per-user in the Figma plugin via clientStorage.
 */

// --- Fix: prevent local node_modules/electron from shadowing Electron's built-in ---
// In Electron 30+, the npm 'electron' package in node_modules returns a path string.
// Patching _resolveFilename removes it from the search path for that one module.
const Module = require('module');
const _localNodeModules = require('path').join(__dirname, 'node_modules');
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'electron' && parent) {
        const patched = Object.assign({}, parent);
        patched.paths = (parent.paths || []).filter(p => !p.startsWith(_localNodeModules));
        return _origResolve.call(this, request, patched, isMain, options);
    }
    return _origResolve.call(this, request, parent, isMain, options);
};

const { app, Tray, Menu, dialog, nativeImage, clipboard, safeStorage } = require('electron');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

let tray        = null;
let serverStatus = 'starting'; // 'starting' | 'running' | 'error'

// ----------------------------------------------------------------
// TOKEN — encrypted with OS-level key (macOS Keychain / Windows DPAPI).
// Falls back to 0o600 plaintext only if safeStorage is unavailable.
// Migrates automatically from the old plaintext plugin-token.txt format.
// ----------------------------------------------------------------
function getOrCreateToken() {
    const dir      = app.getPath('userData');
    const encFile  = path.join(dir, 'plugin-token.enc');
    const legacyFile = path.join(dir, 'plugin-token.txt');

    fs.mkdirSync(dir, { recursive: true });

    const canEncrypt = safeStorage.isEncryptionAvailable();

    // Migrate from old plaintext file if it exists
    if (fs.existsSync(legacyFile) && !fs.existsSync(encFile)) {
        const oldToken = fs.readFileSync(legacyFile, 'utf8').trim();
        if (canEncrypt) {
            fs.writeFileSync(encFile, safeStorage.encryptString(oldToken));
        } else {
            fs.writeFileSync(encFile, oldToken, { mode: 0o600 });
        }
        fs.unlinkSync(legacyFile); // remove plaintext
        return oldToken;
    }

    // Read existing token
    if (fs.existsSync(encFile)) {
        const raw = fs.readFileSync(encFile);
        if (canEncrypt) {
            return safeStorage.decryptString(raw);
        }
        return raw.toString('utf8').trim(); // fallback: plaintext
    }

    // First run — generate new token
    const token = crypto.randomBytes(32).toString('hex');
    if (canEncrypt) {
        fs.writeFileSync(encFile, safeStorage.encryptString(token));
    } else {
        fs.writeFileSync(encFile, token, { mode: 0o600 });
    }
    return token;
}

// ----------------------------------------------------------------
// TRAY ICON
// ----------------------------------------------------------------
function buildTray() {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    let icon;
    if (fs.existsSync(iconPath)) {
        icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
        icon.setTemplateImage(true);
    } else {
        icon = nativeImage.createEmpty();
    }
    tray = new Tray(icon);
    if (process.platform === 'darwin') tray.setTitle(' AFO');
    tray.setToolTip('AFO Image Updater');
}

// ----------------------------------------------------------------
// CONTEXT MENU — rebuilt whenever state changes
// ----------------------------------------------------------------
function rebuildMenu(token) {
    const loginEnabled = app.getLoginItemSettings().openAtLogin;

    const statusLabel =
        serverStatus === 'running'  ? '● Server running on :3000'  :
        serverStatus === 'error'    ? '⚠ Server failed to start'   :
                                      '○ Server starting…';

    const menu = Menu.buildFromTemplate([
        { label: 'AFO Image Updater', enabled: false },
        { label: statusLabel,          enabled: false },
        { type: 'separator' },
        {
            label: 'Show Setup Token…',
            click: () => showTokenDialog(token),
        },
        {
            label: 'Regenerate Token…',
            click: () => confirmRegenerate(),
        },
        { type: 'separator' },
        {
            label: 'Open at Login',
            type: 'checkbox',
            checked: loginEnabled,
            click: (item) => {
                app.setLoginItemSettings({ openAtLogin: item.checked });
                rebuildMenu(token);
            },
        },
        { type: 'separator' },
        { label: 'Quit AFO Image Updater', click: () => app.quit() },
    ]);

    tray.setContextMenu(menu);
}

// ----------------------------------------------------------------
// TOKEN DIALOG — clears clipboard after 60 s
// ----------------------------------------------------------------
function showTokenDialog(token) {
    const choice = dialog.showMessageBoxSync({
        type: 'info',
        title: 'AFO Image Updater — Setup Token',
        message: 'Your plugin security token:',
        detail:
            token +
            '\n\nCopy this token, then open the Figma plugin → Settings (gear icon) → ' +
            'paste into "Security Token" → Save & Connect.\n\n' +
            'This is a one-time setup per team member. ' +
            'The token will be cleared from your clipboard after 60 seconds.',
        buttons: ['Copy Token', 'Close'],
        defaultId: 0,
        cancelId: 1,
    });

    if (choice === 0) {
        clipboard.writeText(token);
        // Clear clipboard after 60 seconds to prevent lingering exposure
        setTimeout(() => {
            if (clipboard.readText() === token) clipboard.clear();
        }, 60_000);
    }
}

// ----------------------------------------------------------------
// TOKEN REGENERATION — relaunches app with a fresh token
// ----------------------------------------------------------------
function confirmRegenerate() {
    const choice = dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Regenerate Token',
        message: 'Create a new security token?',
        detail:
            'The current token will be invalidated immediately. ' +
            'Every team member using the plugin will need to paste the new token into their Settings.\n\n' +
            'The app will restart automatically.',
        buttons: ['Regenerate', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
    });

    if (choice === 0) {
        const encFile = path.join(app.getPath('userData'), 'plugin-token.enc');
        const legacyFile = path.join(app.getPath('userData'), 'plugin-token.txt');
        if (fs.existsSync(encFile))   fs.unlinkSync(encFile);
        if (fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile);
        app.relaunch();
        app.quit();
    }
}

// ----------------------------------------------------------------
// APP READY
// ----------------------------------------------------------------
app.whenReady().then(() => {
    if (app.dock) app.dock.hide();

    const token = getOrCreateToken();

    // Pass token to server via env var, then delete it immediately after
    // the server module has captured it into its own const.
    process.env.PLUGIN_TOKEN = token;
    const { start: startServer } = require('./server.js');
    delete process.env.PLUGIN_TOKEN; // token is now only held in server.js's module scope

    buildTray();
    rebuildMenu(token);

    // Start server and track its live state in the tray menu
    const server = startServer((err) => {
        serverStatus = 'error';
        rebuildMenu(token);
        const msg = err.code === 'EADDRINUSE'
            ? `Port 3000 is already in use.\n\nClose any other process using port 3000 and restart the app.`
            : `The server failed to start: ${err.message}`;
        dialog.showErrorBox('AFO Image Updater — Server Error', msg);
    });

    server.on('listening', () => {
        serverStatus = 'running';
        rebuildMenu(token);
    });

    // First-run: show setup dialog automatically
    const flagFile = path.join(app.getPath('userData'), '.first-run-done');
    if (!fs.existsSync(flagFile)) {
        fs.writeFileSync(flagFile, '1');
        showTokenDialog(token);
    }
});

app.on('window-all-closed', (e) => e.preventDefault());

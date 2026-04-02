// server.js — Express server with token auth always enforced.
// The Electron main process sets process.env.PLUGIN_TOKEN before requiring this file,
// then deletes it from process.env. TOKEN is captured into a module-local const here.

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const glob    = require('glob');
const crypto  = require('crypto');

const app = express();

// Allow localhost variants and null origin (Figma desktop app sends Origin: null).
// The server binds to 127.0.0.1 only, so remote origins are impossible anyway.
// The token is the primary security guard.
app.use(cors({
    origin: (origin, cb) => {
        const allowed = !origin
            || origin === 'null'
            || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        cb(null, allowed);
    }
}));

// Explicit 1 MB request body limit — prevents memory exhaustion from oversized payloads.
app.use(express.json({ limit: '1mb' }));

const PORT = 3000;

// Capture the token from process.env immediately at require() time.
// main.js deletes process.env.PLUGIN_TOKEN right after require(), so TOKEN
// is only held in this module-local variable from this point on.
const TOKEN = process.env.PLUGIN_TOKEN || '';

// Token auth — always required in the Electron app.
// Uses constant-time comparison to prevent timing side-channels.
app.use((req, res, next) => {
    const provided = req.headers['x-plugin-token'] || '';
    const valid = provided.length === TOKEN.length
        && TOKEN.length > 0
        && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(TOKEN));
    if (!valid) return res.status(401).json({ error: 'Unauthorized' });
    next();
});

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Prevent path traversal
function safePath(base, ...parts) {
    const joined = parts.length > 0 ? path.join(base, ...parts) : base;
    const resolved = path.resolve(joined);
    const resolvedBase = path.resolve(base);
    if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
        throw new Error('Path traversal detected');
    }
    return resolved;
}

function getBase64(file) {
    const bitmap = fs.readFileSync(file);
    const ext = path.extname(file).replace('.', '').toLowerCase();
    const mimeMap = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' };
    const mime = mimeMap[ext] || ext;
    return `data:image/${mime};base64,${bitmap.toString('base64')}`;
}

app.post('/get-folders', (req, res) => {
    const rootPath = req.body.rootPath;
    if (!rootPath || !fs.existsSync(rootPath)) {
        return res.status(400).json({ error: 'Invalid path' });
    }
    try {
        const safeRoot = safePath(rootPath);
        const items = fs.readdirSync(safeRoot, { withFileTypes: true });
        const folders = items
            .filter(i => i.isDirectory() && !i.name.startsWith('.'))
            .map(i => i.name);
        res.json(folders);
    } catch (e) {
        console.error('[get-folders]', e.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/find-images', (req, res) => {
    const rootPath = req.body.rootPath;
    const requestedLayerNames = req.body.names || [];
    const selectedFolders = req.body.folders || [];
    const ignoredFolders = (req.body.ignoredFolders || [])
        .filter(f => typeof f === 'string' && f.length > 0 && !/[/\\*?{}[\]!]/.test(f));

    if (!rootPath || !fs.existsSync(rootPath)) {
        return res.status(400).json({ error: 'Invalid path' });
    }

    try {
        let allFiles = [];

        selectedFolders.forEach(subfolder => {
            let subfolderSafe;
            try { subfolderSafe = safePath(rootPath, subfolder); }
            catch { console.warn('[find-images] Blocked traversal:', subfolder); return; }

            const searchGlob = path.join(subfolderSafe, '**/*.{png,jpg,jpeg,webp}').replace(/\\/g, '/');
            const ignorePatterns = ignoredFolders.map(f => `**/${f}/**`);
            allFiles = allFiles.concat(glob.sync(searchGlob, { ignore: ignorePatterns }));
        });

        const fileMap = {};
        allFiles.forEach(filePath => {
            const parsed = path.parse(filePath);
            [parsed.name, parsed.base].forEach(key => {
                if (fileMap[key]) {
                    try {
                        const em = fs.statSync(fileMap[key]).mtime;
                        const nm = fs.statSync(filePath).mtime;
                        if (nm > em) fileMap[key] = filePath;
                    } catch {
                        // File was deleted or became inaccessible between glob and stat — skip
                    }
                } else {
                    fileMap[key] = filePath;
                }
            });
        });

        const responseData = {};
        requestedLayerNames.forEach(name => {
            if (fileMap[name]) {
                try {
                    responseData[name] = getBase64(fileMap[name]);
                } catch {
                    console.warn('[find-images] Could not read file:', fileMap[name]);
                }
            }
        });

        res.json(responseData);
    } catch (e) {
        console.error('[find-images]', e.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// start() — called by main.js (or directly when run as node server.js).
// Returns the http.Server so callers can attach error listeners.
function start(onError) {
    const server = app.listen(PORT, '127.0.0.1', () => {
        console.log(`AFO Image Updater server running on http://127.0.0.1:${PORT}`);
    });
    if (onError) server.on('error', onError);
    return server;
}

// Auto-start when run directly via `node server.js`
if (require.main === module) start();

module.exports = { PORT, start };

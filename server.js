const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const glob = require('glob');

const app = express();

// Allow localhost variants and null origin (Figma desktop app is Electron-based
// and sends Origin: null for local fetch calls). Remote origins are impossible
// anyway since the server binds to 127.0.0.1 only. The token is the real guard.
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
const crypto = require('crypto');

// --- Optional token auth ---
// Set PLUGIN_TOKEN env var to enforce token validation (used by Electron app).
// When running standalone (node server.js), no token is required.
const TOKEN = process.env.PLUGIN_TOKEN || null;
if (TOKEN) {
    app.use((req, res, next) => {
        const provided = req.headers['x-plugin-token'] || '';
        const valid = provided.length === TOKEN.length
            && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(TOKEN));
        if (!valid) return res.status(401).json({ error: 'Unauthorized' });
        next();
    });
}

// --- Health check (used by plugin to detect if server is running) ---
app.get('/health', (_req, res) => res.json({ ok: true }));

// --- Security: prevent path traversal ---
function safePath(base, ...parts) {
    const joined = parts.length > 0 ? path.join(base, ...parts) : base;
    const resolved = path.resolve(joined);
    const resolvedBase = path.resolve(base);
    if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
        throw new Error('Path traversal detected');
    }
    return resolved;
}

// --- Helper: image file to base64 data URI ---
function getBase64(file) {
    const bitmap = fs.readFileSync(file);
    const ext = path.extname(file).replace('.', '').toLowerCase();
    const mimeMap = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' };
    const mime = mimeMap[ext] || ext;
    return `data:image/${mime};base64,${bitmap.toString('base64')}`;
}

// --- 1. Get list of project folders ---
app.post('/get-folders', (req, res) => {
    const rootPath = req.body.rootPath;

    if (!rootPath || !fs.existsSync(rootPath)) {
        return res.status(400).json({ error: 'Invalid path' });
    }

    try {
        const safeRoot = safePath(rootPath);
        const items = fs.readdirSync(safeRoot, { withFileTypes: true });
        const folders = items
            .filter(item => item.isDirectory() && !item.name.startsWith('.'))
            .map(item => item.name);
        res.json(folders);
    } catch (error) {
        console.error('[get-folders]', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 2. Find images and return as base64 ---
app.post('/find-images', (req, res) => {
    const rootPath = req.body.rootPath;
    const requestedLayerNames = req.body.names || [];
    const selectedFolders = req.body.folders || [];

    // Accept ignored folders from the plugin (configurable per team/user).
    // Validate: only simple folder names, no path separators.
    const ignoredFolders = (req.body.ignoredFolders || [])
        .filter(f => typeof f === 'string' && f.length > 0 && !/[/\\]/.test(f));

    if (!rootPath || !fs.existsSync(rootPath)) {
        return res.status(400).json({ error: 'Invalid path' });
    }

    try {
        let allFiles = [];

        selectedFolders.forEach(subfolder => {
            let subfolderSafe;
            try {
                subfolderSafe = safePath(rootPath, subfolder);
            } catch {
                // Skip folders that attempt path traversal
                console.warn('[find-images] Blocked traversal attempt in subfolder:', subfolder);
                return;
            }

            const searchGlob = path.join(subfolderSafe, '**/*.{png,jpg,jpeg,webp}').replace(/\\/g, '/');
            const ignorePatterns = ignoredFolders.map(f => `**/${f}/**`);
            const files = glob.sync(searchGlob, { ignore: ignorePatterns });
            allFiles = allFiles.concat(files);
        });

        // Build file map — on collision, keep the newest file
        const fileMap = {};
        allFiles.forEach(filePath => {
            const parsed = path.parse(filePath);
            [parsed.name, parsed.base].forEach(key => {
                if (fileMap[key]) {
                    const existingMtime = fs.statSync(fileMap[key]).mtime;
                    const newMtime = fs.statSync(filePath).mtime;
                    if (newMtime > existingMtime) fileMap[key] = filePath;
                } else {
                    fileMap[key] = filePath;
                }
            });
        });

        const responseData = {};
        requestedLayerNames.forEach(layerName => {
            if (fileMap[layerName]) {
                responseData[layerName] = getBase64(fileMap[layerName]);
            }
        });

        res.json(responseData);
    } catch (error) {
        console.error('[find-images]', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, '127.0.0.1', () => {
    console.log(`AFO Image Updater server running on http://127.0.0.1:${PORT}`);
});

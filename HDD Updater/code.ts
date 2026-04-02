figma.showUI(__html__, { width: 320, height: 540 });

// --- HELPER: hex color string to Figma RGB ---
function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const h = hex.replace('#', '');
    return {
        r: parseInt(h.substring(0, 2), 16) / 255,
        g: parseInt(h.substring(2, 4), 16) / 255,
        b: parseInt(h.substring(4, 6), 16) / 255,
    };
}

// --- HELPER: Apply or remove highlight stroke ---
function setHighlight(node: SceneNode, active: boolean, color?: { r: number; g: number; b: number }) {
    if ('strokes' in node) {
        if (active) {
            const strokeColor = color || { r: 1, g: 0, b: 1 };
            (node as any).strokes = [{ type: 'SOLID', color: strokeColor }];
            (node as any).strokeWeight = 6;
            (node as any).strokeAlign = 'CENTER';
        } else {
            (node as any).strokes = [];
        }
    }
}

// --- HELPER: Read/write the persisted list of last-synced node IDs ---
// Stored on figma.root so it survives plugin close/reopen.
// Using root avoids any per-node getPluginData calls.
const LAST_IDS_KEY = 'afoLastSyncIds';
function loadLastIds(): string[] {
    try { return JSON.parse(figma.root.getPluginData(LAST_IDS_KEY) || '[]'); } catch { return []; }
}
function saveLastIds(ids: string[]) {
    figma.root.setPluginData(LAST_IDS_KEY, JSON.stringify(ids));
}

figma.ui.onmessage = async (msg) => {

    // --- SAVE/LOAD SETTINGS ---
    if (msg.type === 'load-settings') {
        const savedPath    = await figma.clientStorage.getAsync('hdd_root_path');
        const savedIgnored = await figma.clientStorage.getAsync('hdd_ignored_folders');
        const savedColor   = await figma.clientStorage.getAsync('hdd_highlight_color');
        const savedToken   = await figma.clientStorage.getAsync('hdd_token');
        figma.ui.postMessage({
            type: 'settings-loaded',
            path: savedPath || '',
            ignoredFolders: savedIgnored ?? 'Animation, Marketing',
            highlightColor: savedColor || '#FF00FF',
            token: savedToken || '',
        });
    }

    if (msg.type === 'save-settings') {
        await figma.clientStorage.setAsync('hdd_root_path', msg.path);
        await figma.clientStorage.setAsync('hdd_ignored_folders', msg.ignoredFolders);
        await figma.clientStorage.setAsync('hdd_highlight_color', msg.highlightColor);
        await figma.clientStorage.setAsync('hdd_token', msg.token);
        figma.notify('Settings saved!');
    }

    // --- SCAN LAYERS ---
    // Pure read — one findAll pass, NO getPluginData calls, NO mutations.
    // Only collects IMAGE-fill nodes and sends id+name pairs to the UI.
    if (msg.type === 'scan-layers') {
        const imageLayers: { id: string; name: string }[] = [];

        figma.currentPage.findAll(n => {
            if ('fills' in n && n.name.trim().length > 0) {
                const fills = (n as any).fills as Paint[];
                if (Array.isArray(fills) && fills.some((f: Paint) => f.type === 'IMAGE')) {
                    imageLayers.push({ id: n.id, name: n.name });
                }
            }
            return false;
        });

        figma.ui.postMessage({
            type: 'fetch-images',
            names: [...new Set(imageLayers.map(l => l.name))],
            layers: imageLayers,  // id+name — used in update-layers for getNodeById
            folders: msg.folders,
            ignoredFolders: msg.ignoredFolders,
            token: msg.token,
        });
    }

    // --- UPDATE LAYERS ---
    if (msg.type === 'update-layers') {
        const updates        = msg.data;                                  // name → Uint8Array
        const nodeIds        = msg.nodeIds as Record<string, string[]>;   // name → [id, ...]
        const showHighlights = msg.showHighlights;
        const highlightColor = msg.highlightColor ? hexToRgb(msg.highlightColor) : { r: 1, g: 0, b: 1 };
        let count = 0;
        let errorCount = 0;

        // Clear previous highlights — direct ID lookups, zero tree traversal.
        for (const id of loadLastIds()) {
            const n = await figma.getNodeByIdAsync(id) as SceneNode | null;
            if (n) { n.setPluginData('wasUpdated', ''); setHighlight(n, false); }
        }

        // Apply updates — also via direct ID lookups (no findAll per layer name).
        const newIds: string[] = [];
        for (const [name, data] of Object.entries(updates)) {
            if (!(data instanceof Uint8Array)) {
                console.error(`Expected Uint8Array for "${name}", got ${typeof data}`);
                errorCount++;
                continue;
            }
            for (const id of (nodeIds[name] || [])) {
                const node = await figma.getNodeByIdAsync(id) as SceneNode | null;
                if (!node || !('fills' in node)) continue;
                try {
                    const newImage  = figma.createImage(data as Uint8Array);
                    const oldFills  = node.fills as Paint[];
                    const scaleMode = oldFills.length > 0 && oldFills[0].type === 'IMAGE'
                        ? oldFills[0].scaleMode : 'FILL';

                    node.fills = [{ type: 'IMAGE', imageHash: newImage.hash, scaleMode }];
                    node.setPluginData('wasUpdated', 'true');
                    if (showHighlights) setHighlight(node, true, highlightColor);
                    newIds.push(id);
                    count++;
                } catch (e) {
                    console.error(`Failed to update "${name}" (${id}):`, e);
                    errorCount++;
                }
            }
        }

        // Persist the updated IDs so the NEXT sync can clean them up without traversal.
        saveLastIds(newIds);

        const message = errorCount > 0
            ? `Updated ${count} layers. ${errorCount} failed.`
            : `Updated ${count} layers.`;
        figma.ui.postMessage({ type: 'complete', message, count, errorCount });
    }

    // --- TOGGLE HIGHLIGHTS ---
    if (msg.type === 'toggle-highlights') {
        const active = msg.show;
        // No traversal — use persisted IDs.
        for (const id of loadLastIds()) {
            const n = await figma.getNodeByIdAsync(id) as SceneNode | null;
            if (n) setHighlight(n, active);
        }
        figma.notify(`Highlights ${active ? 'shown' : 'hidden'}`);
    }
};

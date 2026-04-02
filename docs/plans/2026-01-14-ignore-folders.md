# Ignore Specific Folders Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent files in "Animation" and "Marketing" folders from being picked up during file scans.

**Architecture:** Update the `glob` search pattern in `server.js` to explicitly ignore these directories.

**Tech Stack:** Node.js, Express, glob.

---

### Task 1: Create Integration Test

**Files:**
- Create: `tests/integration_ignore.js`

**Step 1: Write the failing test**

```javascript
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const TEST_DIR = path.join(__dirname, 'temp_test_env');
const PORT = 3000;

async function setup() {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR);
    fs.mkdirSync(path.join(TEST_DIR, 'Animation'));
    fs.mkdirSync(path.join(TEST_DIR, 'Marketing'));
    fs.mkdirSync(path.join(TEST_DIR, 'Normal'));
    
    fs.writeFileSync(path.join(TEST_DIR, 'Animation', 'ignore_me.png'), 'fake-image');
    fs.writeFileSync(path.join(TEST_DIR, 'Marketing', 'ignore_me_too.png'), 'fake-image');
    fs.writeFileSync(path.join(TEST_DIR, 'Normal', 'keep_me.png'), 'fake-image');
}

function runTest() {
    // We assume server is running on localhost:3000
    // In a real CI we would spawn it, but for local dev we check the running instance.
    
    fetch(`http://localhost:${PORT}/find-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            rootPath: TEST_DIR,
            folders: ['.'], // Search from root of test dir
            names: ['ignore_me', 'ignore_me_too', 'keep_me']
        })
    })
    .then(res => res.json())
    .then(data => {
        let failed = false;
        if (data['ignore_me']) {
            console.error('FAIL: Found file in Animation folder');
            failed = true;
        }
        if (data['ignore_me_too']) {
            console.error('FAIL: Found file in Marketing folder');
            failed = true;
        }
        if (!data['keep_me']) {
            console.error('FAIL: Did not find file in Normal folder');
            failed = true;
        }
        
        if (!failed) console.log('PASS: Ignored folders correctly');
        
        // Cleanup
        // fs.rmSync(TEST_DIR, { recursive: true, force: true });
        process.exit(failed ? 1 : 0);
    })
    .catch(err => {
        console.error('Error connecting to server:', err);
        process.exit(1);
    });
}

setup().then(runTest);
```

**Step 2: Run test to verify it fails**

Run: `node tests/integration_ignore.js`
Expected: FAIL (because current code finds all files)

**Step 3: Write minimal implementation (Skip - this is just setting up the test)**

*Since we are relying on the existing server code, we just need to commit this test first.*

**Step 4: Run test to verify it passes**

*It should still FAIL.*

**Step 5: Commit**

```bash
git add tests/integration_ignore.js
git commit -m "test: add reproduction for ignore folders"
```

---

### Task 2: Implement Ignore Logic

**Files:**
- Modify: `server.js`

**Step 1: Write the failing test**

*Already written in Task 1.*

**Step 2: Run test to verify it fails**

Run: `node tests/integration_ignore.js`
Expected: FAIL

**Step 3: Write minimal implementation**

Modify `allFiles.concat(files)` block in `server.js`:

```javascript
/* ... inside selectedFolders.forEach ... */
// Add ignore option
const files = glob.sync(safePath, {
    ignore: [
        '**/Animation/**',
        '**/Marketing/**'
    ]
});
```

**Step 4: Run test to verify it passes**

*Important: You must restart the server before running the test!*

1. Kill existing server (Ctrl+C or kill command).
2. Start server: `node server.js &` (or in separate tab).
3. Run: `node tests/integration_ignore.js`
Expected: PASS

**Step 5: Commit**

```bash
git add server.js
git commit -m "feat: ignore Animation and Marketing folders"
```

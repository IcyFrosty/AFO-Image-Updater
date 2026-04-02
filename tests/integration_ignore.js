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
            fs.rmSync(TEST_DIR, { recursive: true, force: true });
            process.exit(failed ? 1 : 0);
        })
        .catch(err => {
            console.error('Error connecting to server:', err);
            process.exit(1);
        });
}

setup().then(runTest);

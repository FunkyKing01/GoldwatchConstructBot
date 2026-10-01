// Hosting companies usually start `index.js`; the bot itself lives in bot.js.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// On the host, fetch the latest version from GitHub before starting, so an update only needs a restart.
// Skipped on Windows, where the copy on the PC is the one being edited.
const folder = fileURLToPath(new URL('.', import.meta.url));
if (process.platform !== 'win32' && existsSync(`${folder}.git`)) {
  try {
    const result = execSync('git pull --ff-only', { cwd: folder, encoding: 'utf8', timeout: 60000 });
    console.log(`Update check: ${result.trim()}`);
  } catch (err) {
    console.error(`Update check failed, starting the version already here. ${String(err.stderr || err.message).trim()}`);
  }
}

await import('./bot.js');

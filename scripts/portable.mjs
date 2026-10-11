// Builds a portable Windows copy of the app: a folder (and a ZIP of it) that runs without an installer.
//
// The folder holds the executable, WebView2Loader.dll (the windows-gnu toolchain links it dynamically), and the
// built-in stories, which the app reads from its resource directory, i.e. the executable's folder on Windows.
// It's built with the `portable` feature, so saves, the designer's library, and the settings go to a `data` folder
// next to the executable instead of the app data directory.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const tauri = join(root, "src-tauri");
const release = join(tauri, "target", "release");

const config = JSON.parse(readFileSync(join(tauri, "tauri.conf.json"), "utf8"));
const name = `${config.productName}-${config.version}-portable`;
const out = join(root, "portable", name);
const zip = `${out}.zip`;

execSync("npm run tauri build -- --no-bundle --features portable", { cwd: root, stdio: "inherit" });

rmSync(out, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(out, { recursive: true });

cpSync(join(release, "elementary.exe"), join(out, `${config.productName}.exe`));
const loader = join(release, "WebView2Loader.dll");
if (existsSync(loader)) cpSync(loader, join(out, "WebView2Loader.dll"));
cpSync(join(tauri, "stories"), join(out, "stories"), { recursive: true });

execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${out}' -DestinationPath '${zip}'"`, {
  stdio: "inherit",
});

console.log(`\nPortable app: ${out}\nZIP: ${zip}`);

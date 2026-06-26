import { existsSync } from "node:fs";
import { mkdir, copyFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");
const distDir = path.join(rootDir, "dist");
const exampleEnv = path.join(rootDir, ".env.example");
const envLocal = path.join(rootDir, ".env.local");
const rootNodeModules = path.join(rootDir, "node_modules");
const webNodeModules = path.join(rootDir, "web", "node_modules");
const electronDist = path.join(rootNodeModules, "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const electronMirror = "https://npmmirror.com/mirrors/electron/";
const builderBinariesMirror = "https://npmmirror.com/mirrors/electron-builder-binaries/";

const mirrorEnv = {
  ELECTRON_MIRROR: electronMirror,
  ELECTRON_BUILDER_BINARIES_MIRROR: builderBinariesMirror,
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      ...mirrorEnv,
      ...options.env
    },
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

async function ensureEnvFile() {
  if (existsSync(envLocal)) return;
  if (existsSync(exampleEnv)) {
    await copyFile(exampleEnv, envLocal);
    return;
  }
}

async function main() {
  await ensureEnvFile();
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });

  if (process.platform === "win32") {
    if (!existsSync(rootNodeModules)) {
      run("cmd", ["/c", "npm", "install", "--no-fund", "--no-audit", "--package-lock=false"]);
    }
    if (!existsSync(webNodeModules)) {
      run("cmd", ["/c", "npm", "--prefix", "web", "install", "--no-fund", "--no-audit", "--package-lock=false"]);
    }
    if (!existsSync(electronDist)) {
      run("node", ["node_modules/electron/install.js"]);
    }
    run("cmd", ["/c", "npm", "run", "build"]);
    run("cmd", ["/c", "npx", "electron-builder", "--win", "portable"]);
  } else {
    if (!existsSync(rootNodeModules)) {
      run("npm", ["install", "--no-fund", "--no-audit", "--package-lock=false"]);
    }
    if (!existsSync(webNodeModules)) {
      run("npm", ["--prefix", "web", "install", "--no-fund", "--no-audit", "--package-lock=false"]);
    }
    if (!existsSync(electronDist)) {
      run("node", ["node_modules/electron/install.js"]);
    }
    run("npm", ["run", "build"]);
    run("npx", ["electron-builder", "--win", "portable"]);
  }

  const items = await readdir(releaseDir);
  const exeName = items.find((name) => name.toLowerCase().endsWith(".exe"));
  if (!exeName) {
    throw new Error(`没有找到打包产物：${releaseDir}`);
  }
  const produced = path.join(releaseDir, exeName);

  console.log(`打包完成：${produced}`);
  console.log(`前端产物目录：${distDir}`);
  console.log(`根配置文件：${envLocal}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");

let mainWindow = null;
let serverProcess = null;
let serverPort = null;
let shuttingDown = false;
let configDir = null;
let serverReadyResolve;
let serverReadyReject;

const serverReady = new Promise((resolve, reject) => {
  serverReadyResolve = resolve;
  serverReadyReject = reject;
});

function appRoot() {
  return app.getAppPath();
}

function userDataRoot() {
  return app.getPath("userData");
}

function dataDir() {
  return path.join(userDataRoot(), "data");
}

function exeDir() {
  return path.dirname(process.execPath);
}

async function chooseConfigDir() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const candidates = [portableDir, exeDir(), userDataRoot()].filter(Boolean);
  for (const dir of candidates) {
    try {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.access(dir, fs.constants.W_OK);
      return dir;
    } catch {
      // try next candidate
    }
  }
  return userDataRoot();
}

async function ensureStarterEnvFile() {
  const target = path.join(configDir, ".env.local");
  if (fs.existsSync(target)) return;
  const example = path.join(appRoot(), ".env.example");
  if (fs.existsSync(example)) {
    await fsp.copyFile(example, target);
    return;
  }
  const fallback = [
    "OPENAI_API_KEY=",
    "OPENAI_BASE_URL=https://api.openai.com/v1",
    "IMAGE_MODEL=gpt-image-2",
    "VISION_TEXT_MODEL=gpt-5-mini",
    "DEFAULT_CANDIDATES=4",
    "PORT=3678",
    ""
  ].join("\n");
  await fsp.writeFile(target, fallback, "utf8");
}

function parsePortFromLine(line) {
  const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(line);
  return match ? Number.parseInt(match[1], 10) : null;
}

function spawnServer() {
  const entry = path.join(appRoot(), "server.mjs");
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PORT: "0",
    SKU_IMAGE_FLOW_DATA_DIR: dataDir(),
    SKU_IMAGE_FLOW_ENV_DIR: configDir,
    SKU_IMAGE_FLOW_DIST_DIR: path.join(appRoot(), "dist")
  };

  serverProcess = spawn(process.execPath, [entry], {
    cwd: appRoot(),
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const finishWithError = (message) => {
    if (serverReadyReject) serverReadyReject(new Error(message));
    if (!shuttingDown) {
      dialog.showErrorBox("电商图片工作流启动失败", message);
      app.quit();
    }
  };

  const stdout = readline.createInterface({ input: serverProcess.stdout });
  stdout.on("line", (line) => {
    const port = parsePortFromLine(line);
    if (port && !serverPort) {
      serverPort = port;
      if (serverReadyResolve) serverReadyResolve(port);
    }
    console.log(`[server] ${line}`);
  });

  serverProcess.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8").trimEnd();
    if (!text) return;
    for (const line of text.split(/\r?\n/)) console.error(`[server] ${line}`);
  });

  serverProcess.on("error", (error) => {
    finishWithError(error instanceof Error ? error.message : String(error));
  });

  serverProcess.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (!serverPort) {
      finishWithError(`后端进程异常退出（code=${code ?? "null"}, signal=${signal ?? "null"}）`);
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  mainWindow = win;
  return win;
}

async function boot() {
  app.setAppUserModelId("com.skuimageflow.desktop");
  configDir = await chooseConfigDir();
  await fsp.mkdir(dataDir(), { recursive: true });
  await ensureStarterEnvFile();
  spawnServer();

  const port = await serverReady;
  const win = createWindow();
  await win.loadURL(`http://127.0.0.1:${port}`);
}

function stopServer() {
  shuttingDown = true;
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    boot().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox("电商图片工作流启动失败", message);
      app.quit();
    });
  });

  app.on("before-quit", () => {
    stopServer();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

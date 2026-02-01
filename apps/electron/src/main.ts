import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import type { BrowserWindow as ElectronBrowserWindow } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

const preloadPath = path.join(__dirname, "preload.js");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_DEV === "1");
const APP_DISPLAY_NAME = "兴河PPT";

app.setName(APP_DISPLAY_NAME);

let serverClose: (() => Promise<void>) | null = null;
let mainWindow: ElectronBrowserWindow | null = null;
let ipcHandlersRegistered = false;
let bootstrapPromise: Promise<void> | null = null;

function resolveIconPath(): string | null {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "favicon.png")
    : path.resolve(app.getAppPath(), "../../favicon.png");
  return existsSync(candidate) ? candidate : null;
}

async function waitForHttpReady(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Dev server not reachable: ${url}`);
}

async function startInternalServer(): Promise<string> {
  const serverModulePath = path.join(app.getAppPath(), "node_modules/server/dist/server.js");
  const { startServer } = (await import(serverModulePath)) as {
    startServer: (opts: {
      port?: number;
      host?: string;
      logger?: boolean;
      webDistDir?: string | null;
    }) => Promise<{ app: { close: () => Promise<void> }; address: string }>;
  };

  const webDistDir = app.isPackaged
    ? path.join(process.resourcesPath, "web-dist")
    : path.resolve(app.getAppPath(), "../web/dist");

  const { app: fastifyApp, address } = await startServer({
    port: 0,
    host: "127.0.0.1",
    logger: false,
    webDistDir,
  });

  serverClose = async () => {
    await fastifyApp.close();
  };

  return address;
}

function openExternal(url: string): void {
  void shell.openExternal(url);
}

async function openPath(targetPath: string): Promise<void> {
  const err = await shell.openPath(targetPath);
  if (err) {
    throw new Error(err);
  }
}

function showItemInFolder(targetPath: string): void {
  shell.showItemInFolder(targetPath);
}

function createMainWindow(startUrl: string): ElectronBrowserWindow {
  const iconPath = resolveIconPath();
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0D1117",
    icon: iconPath ?? undefined,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });

  void win.loadURL(startUrl);
  return win;
}

function registerIpcHandlers(): void {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  ipcMain.handle("aippt:selectProjectFolder", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 兴河PPT 项目文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("aippt:openExternal", async (_evt, url: string) => {
    if (typeof url !== "string" || url.trim() === "") return;
    openExternal(url);
  });

  ipcMain.handle("aippt:openPath", async (_evt, targetPath: string) => {
    if (typeof targetPath !== "string" || targetPath.trim() === "") return;
    await openPath(targetPath);
  });

  ipcMain.handle("aippt:showItemInFolder", async (_evt, targetPath: string) => {
    if (typeof targetPath !== "string" || targetPath.trim() === "") return;
    showItemInFolder(targetPath);
  });

  ipcMain.handle("aippt:window:minimize", async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    win?.minimize();
  });

  ipcMain.handle("aippt:window:toggleMaximize", async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle("aippt:window:isMaximized", async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    return Boolean(win?.isMaximized());
  });

  ipcMain.handle("aippt:window:close", async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    win?.close();
  });
}

async function bootstrap(): Promise<void> {
  process.env.AIPPT_CONFIG_DIR = app.getPath("userData");
  process.env.AIPPT_PROJECTS_DIR = path.join(app.getPath("documents"), "兴河PPT Projects");

  registerIpcHandlers();

  let startUrl: string;
  if (isDev) {
    startUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
    await waitForHttpReady(startUrl, 45_000);
  } else {
    startUrl = await startInternalServer();
  }

  const iconPath = resolveIconPath();
  if (iconPath && process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    } catch {
      // ignore
    }
  }

  mainWindow = createMainWindow(startUrl);
}

function bootstrapSafe(): void {
  if (bootstrapPromise) return;
  bootstrapPromise = bootstrap()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
    })
    .finally(() => {
      bootstrapPromise = null;
    });
}

app.on("window-all-closed", async () => {
  if (serverClose) await serverClose();
  serverClose = null;
  mainWindow = null;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow == null) {
    bootstrapSafe();
  }
});

void app.whenReady().then(bootstrapSafe);

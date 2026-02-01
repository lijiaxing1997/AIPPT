import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("aippt", {
  isElectron: true,
  selectProjectFolder: async (): Promise<string | null> => {
    return await ipcRenderer.invoke("aippt:selectProjectFolder");
  },
  openExternal: async (url: string): Promise<void> => {
    await ipcRenderer.invoke("aippt:openExternal", url);
  },
  openPath: async (path: string): Promise<void> => {
    await ipcRenderer.invoke("aippt:openPath", path);
  },
  showItemInFolder: async (path: string): Promise<void> => {
    await ipcRenderer.invoke("aippt:showItemInFolder", path);
  },
  minimize: async (): Promise<void> => {
    await ipcRenderer.invoke("aippt:window:minimize");
  },
  toggleMaximize: async (): Promise<void> => {
    await ipcRenderer.invoke("aippt:window:toggleMaximize");
  },
  isMaximized: async (): Promise<boolean> => {
    return await ipcRenderer.invoke("aippt:window:isMaximized");
  },
  closeWindow: async (): Promise<void> => {
    await ipcRenderer.invoke("aippt:window:close");
  },
});

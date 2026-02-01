export {};

declare global {
  interface Window {
    aippt?: {
      isElectron?: boolean;
      selectProjectFolder?: () => Promise<string | null>;
      openExternal?: (url: string) => Promise<void>;
      openPath?: (path: string) => Promise<void>;
      showItemInFolder?: (path: string) => Promise<void>;
      minimize?: () => Promise<void>;
      toggleMaximize?: () => Promise<void>;
      isMaximized?: () => Promise<boolean>;
      closeWindow?: () => Promise<void>;
    };
  }
}

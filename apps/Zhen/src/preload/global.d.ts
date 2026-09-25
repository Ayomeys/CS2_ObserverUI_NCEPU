import { ElectronAPI } from "@electron-toolkit/preload";
import type { WindowAPI } from "../shared/ipc";

declare global {
  interface Window {
    directorMap: {
      getSnapshot: () => Promise<import("@zhenhai/csgogsi/types").GameState | null>;
      onData: (callback: (data: import("@zhenhai/csgogsi/types").GameState) => void) => () => void;
      onEvent: (callback: (name: import("@zhenhai/csgogsi/gsi-vue").GsiEventName, args: unknown[]) => void) => () => void;
    };
    electron: ElectronAPI;
    api: WindowAPI;
  }
}

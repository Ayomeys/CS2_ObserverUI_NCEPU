import { app, BrowserWindow, screen } from "electron";
import { join } from "path";
import type { GameState } from "@zhenhai/csgogsi/types";
import { logger } from "./logger.service";
import type { GsiService } from "./gsi.service";
import icon from "../../../resources/icon.ico?asset";

/** 仅在导播电脑上加载的地图窗口；页面与数据都不经过 HTTP 静态路由。 */
class DirectorMapService {
  private window: BrowserWindow | null = null;
  private gsiService: GsiService | null = null;
  private latestData: GameState | null = null;
  private desiredVisible = false;

  private readonly onData = (data: GameState): void => {
    this.latestData = data;
    if (this.desiredVisible && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("director-map:data", data);
    }
  };

  private readonly onRoundStart = (...args: unknown[]): void => this.sendEvent("roundStart", args);
  private readonly onBombExplode = (...args: unknown[]): void => this.sendEvent("bombExplode", args);
  private readonly onBombDefuse = (...args: unknown[]): void => this.sendEvent("bombDefuse", args);

  init(gsiService: GsiService): void {
    this.gsiService = gsiService;
  }

  getSnapshot(senderId: number): GameState | null {
    return this.window?.webContents.id === senderId ? this.latestData : null;
  }

  toggle(): void {
    const win = this.window;
    if (win && !win.isDestroyed()) {
      this.desiredVisible = !this.desiredVisible;
      if (this.desiredVisible) {
        win.showInactive();
        win.moveTop();
        if (this.latestData) win.webContents.send("director-map:data", this.latestData);
      } else {
        win.hide();
      }
      return;
    }

    this.desiredVisible = true;
    try {
      this.create();
    } catch (error) {
      this.desiredVisible = false;
      logger.error("DirectorMap", "Failed to create the director map window", error);
    }
  }

  private sendEvent(name: string, args: unknown[]): void {
    this.window?.webContents.send("director-map:event", name, args);
  }

  private attachGsi(): void {
    if (!this.gsiService) return;
    this.gsiService.on("gsi:data", this.onData);
    this.gsiService.on("roundStart", this.onRoundStart);
    this.gsiService.on("bombExplode", this.onBombExplode);
    this.gsiService.on("bombDefuse", this.onBombDefuse);
  }

  private detachGsi(): void {
    if (!this.gsiService) return;
    this.gsiService.off("gsi:data", this.onData);
    this.gsiService.off("roundStart", this.onRoundStart);
    this.gsiService.off("bombExplode", this.onBombExplode);
    this.gsiService.off("bombDefuse", this.onBombDefuse);
  }

  private create(): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const edge = Math.min(display.bounds.width, display.bounds.height);
    const win = new BrowserWindow({
      x: display.bounds.x + Math.floor((display.bounds.width - edge) / 2),
      y: display.bounds.y + Math.floor((display.bounds.height - edge) / 2),
      width: edge,
      height: edge,
      show: false,
      frame: false,
      transparent: true,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      title: "Director Map",
      icon,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });

    this.window = win;
    this.latestData = null;
    this.attachGsi();
    win.setAlwaysOnTop(true, "screen-saver", 1);
    win.setIgnoreMouseEvents(true, { forward: true });

    win.once("ready-to-show", () => {
      if (this.desiredVisible && !win.isDestroyed()) {
        win.showInactive();
        win.moveTop();
        if (this.latestData) win.webContents.send("director-map:data", this.latestData);
      }
    });

    win.on("closed", () => {
      this.detachGsi();
      this.window = null;
      this.latestData = null;
      this.desiredVisible = false;
    });

    const page = app.isPackaged
      ? join(process.resourcesPath, "director-map", "director.html")
      : join(__dirname, "../../resources/director-map/director.html");

    void win.loadFile(page).catch((error: unknown) => {
      logger.error("DirectorMap", "Failed to load the local director map", error);
      win.close();
    });
  }
}

export const directorMapService = new DirectorMapService();

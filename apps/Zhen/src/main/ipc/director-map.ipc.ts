import { ipcMain } from "electron";
import { directorMapService } from "../services/director-map.service";

export function registerDirectorMapIpc(): void {
  ipcMain.handle("director-map:snapshot", (event) =>
    directorMapService.getSnapshot(event.sender.id),
  );
}

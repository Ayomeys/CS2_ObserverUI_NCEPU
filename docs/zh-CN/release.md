# 发布

[English](../en-US/release.md) · [返回 README](../../README_ZH.md)

工作区如何产出 Windows 安装包、安装包里包含什么，以及已安装客户端如何自动更新。

## 构建链路

```bash
bun run build        # apps/Hai build -> apps/Zhen build:win
```

| 步骤 | 命令 | 产物 |
| --- | --- | --- |
| 1 | `bun run --cwd apps/Hai build` | Overlay 构建输出到 `apps/Zhen/resources/overlay`（类型检查 + Vite 构建） |
| 2 | 设置 `apps/Zhen/package.json` 的 `version` | 构建直接使用该版本号；需要时可单独运行 `bun run --cwd apps/Zhen version:patch` |
| 3 | `bun run --cwd apps/Zhen build` | 构建导播地图本地页面 → `typecheck` → `electron-vite build` → `pack:overlay` |
| 4 | `electron-builder --win` | 在 `apps/Zhen/dist` 生成 NSIS 安装包（electron-builder 的输出目录；`--dir` 输出到 `apps/Zhen/dist/win-unpacked`） |

`pack:overlay` 要求构建产物中包含 `overlay.json`，会把应用版本号写入该清单，输出到仓库根目录的 `dist/zhenhai-default-<version>.zip`，并删除旧版本的压缩包。该 zip 是内置 Overlay 的再分发包，可通过 Overlays 页面重新导入；`dist/` 目录被 git 忽略，且 `electron-builder` 从不引用它，因此资源包压缩件不会被放进安装包。

## 安装包内容

打包配置位于 `apps/Zhen/electron-builder.yml`：

| 配置 | 值 |
| --- | --- |
| 应用 id | `com.zhenhai.zhen` |
| 产品名 | `ObserverUI` |
| Windows 可执行文件 | `ObserverUI.exe` |
| 安装包产物 | `ObserverUI-<version>-setup.exe`（NSIS，桌面快捷方式名为 `ObserverUI`） |
| extraResources | `resources/overlay` → `overlay`、`resources/director-map` → `director-map`、`resources/overlays` → `overlays`、`resources/gamestate_integration_zhenhai.cfg` → `gamestate_integration_zhenhai.cfg` |
| asar 解包 | `resources/**`，保证 GSI 配置与 Overlay 文件在磁盘上可直接读取 |
| 更新源 | GitHub，`Ayomeys/CS2_ObserverUI_NCEPU` |
| Electron 下载镜像 | `https://npmmirror.com/mirrors/electron/` |

由于 `resources/overlay` 与 GSI 配置放在 `extraResources` 中，安装后的目录结构会把它们保留在 asar 之外，同时仍然随应用一起分发。

`director-map` 也作为独立资源随安装包分发，只由本机 Electron 窗口读取，不注册 1469 静态路由。

## 自动更新

已安装版本通过 `electron-updater` 检查更新，并通过 `updater:event` IPC 通道上报进度，类型包括 `checking`、`available`、`not-available`、`downloading`、`downloaded`、`error`。`downloading` 会带上 `percent` 字段，设置面板据此渲染下载进度条；`downloaded` 之后即可执行安装（`updater:install`）。

未打包的开发构建不会自我更新；要端到端验证更新流程，请使用打包后的安装版本。

## 发布检查清单

1. 确认工作区干净且单元测试通过（`bun run --cwd apps/Zhen test`）。
2. 确认 `apps/Zhen/package.json` 中的版本号后，在 Windows 上执行 `bun run build` 生成安装包。
3. 验证安装包：GSI 配置能安装、Overlay 能在 `/overlay/` 打开、导播地图快捷键能显示／隐藏本机地图且数字键仍可在 CS2 切人、`dist/zhenhai-default-<version>.zip` 可导入、原有 Overlay 仍在列表中。
4. 为该 tag 创建 GitHub Release 并附上 `ObserverUI-<version>-setup.exe`；发布配置与本仓库匹配，`electron-builder` 也可以直接上传。
5. 已安装客户端会通过更新器获取该版本，先显示下载进度条，再提供重启安装的入口。

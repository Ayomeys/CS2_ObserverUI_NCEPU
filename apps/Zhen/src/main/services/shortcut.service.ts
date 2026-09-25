import { globalShortcut } from "electron";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  SHORTCUT_ACTION_LABELS,
  canonicalAccelerator,
  findDuplicateBindings,
  type ShortcutAction,
  type ShortcutBindings,
  type ShortcutRegistrationMap,
} from "../../shared/shortcuts";
import { errorMessage } from "../../shared/errors";
import { logger } from "./logger.service";

export type ShortcutHandler = () => void;

export interface DynamicShortcutResult {
  id: string;
  accelerator: string;
  success: boolean;
  error?: string;
}

/**
 * 全局快捷键注册表。
 *
 * - 每个动作独立注册，逐个返回成功/失败原因（组合键冲突、被其它程序占用等）；
 * - 只有注册成功才会被记为「当前生效」，避免设置界面显示一个实际未生效的键；
 * - 启动时注册全部动作；保存设置时只更新修改过的动作，保留未修改的注册状态。
 */
class ShortcutService {
  private static instance: ShortcutService;

  private readonly handlers = new Map<ShortcutAction, ShortcutHandler>();
  private readonly registered = new Map<ShortcutAction, string>();
  private readonly configured = new Map<ShortcutAction, string>();
  /** 动态（Overlay 声明）快捷键：scope → (shortcutId → accelerator)。 */
  private readonly dynamicScopes = new Map<string, Map<string, string>>();
  private lastDynamicResults: DynamicShortcutResult[] = [];

  static getInstance(): ShortcutService {
    if (!ShortcutService.instance) {
      ShortcutService.instance = new ShortcutService();
    }

    return ShortcutService.instance;
  }

  setHandler(action: ShortcutAction, handler: ShortcutHandler): void {
    this.handlers.set(action, handler);
  }

  register(bindings: ShortcutBindings): ShortcutRegistrationMap {
    this.unregisterActions();

    const duplicated = new Set<ShortcutAction>();

    for (const actions of findDuplicateBindings(bindings).values()) {
      for (const action of actions) {
        duplicated.add(action);
      }
    }

    const results = {} as ShortcutRegistrationMap;

    for (const action of SHORTCUT_ACTIONS) {
      const accelerator = (bindings[action] ?? DEFAULT_SHORTCUTS[action]).trim();
      const label = SHORTCUT_ACTION_LABELS[action];

      if (!accelerator) {
        results[action] = { accelerator, success: false, error: "快捷键不能为空" };
        continue;
      }

      if (duplicated.has(action)) {
        results[action] = { accelerator, success: false, error: "与其它动作的组合键重复" };
        logger.error("ShortcutService", `Duplicate accelerator for ${label}: ${accelerator}`);
        continue;
      }

      const handler = this.handlers.get(action);

      if (!handler) {
        results[action] = { accelerator, success: false, error: "缺少动作处理器" };
        logger.error("ShortcutService", `No handler registered for action: ${action}`);
        continue;
      }

      let success = false;

      try {
        success = globalShortcut.register(accelerator, handler);
      } catch (error) {
        results[action] = { accelerator, success: false, error: errorMessage(error) };
        logger.error("ShortcutService", `Invalid accelerator for ${label}: ${accelerator}`, error);
        continue;
      }

      if (success) {
        this.registered.set(action, accelerator);
        results[action] = { accelerator, success: true };
        logger.info("ShortcutService", `Registered ${label}: ${accelerator}`);
      } else {
        results[action] = { accelerator, success: false, error: "该组合键已被其它程序占用" };
        logger.error("ShortcutService", `Failed to register ${label}: ${accelerator}`);
      }
    }

    this.configured.clear();
    for (const action of SHORTCUT_ACTIONS) {
      this.configured.set(action, results[action].accelerator);
    }

    return results;
  }

  update(bindings: ShortcutBindings): ShortcutRegistrationMap {
    const requested = {} as Record<ShortcutAction, string>;
    const results = {} as ShortcutRegistrationMap;
    const changed: ShortcutAction[] = [];

    for (const action of SHORTCUT_ACTIONS) {
      const accelerator = (bindings[action] ?? this.configured.get(action) ?? DEFAULT_SHORTCUTS[action]).trim();
      requested[action] = accelerator;

      if (canonicalAccelerator(accelerator) !== canonicalAccelerator(this.configured.get(action) ?? "")) {
        changed.push(action);
      } else {
        results[action] = this.registered.has(action)
          ? { accelerator, success: true }
          : { accelerator, success: false, error: "该快捷键当前未生效" };
      }
    }

    if (changed.length === 0) return results;

    const duplicates = findDuplicateBindings(requested);
    const duplicated = new Set([...duplicates.values()].flat());
    let invalid = false;
    for (const action of changed) {
      const accelerator = requested[action];
      const error = !accelerator
        ? "快捷键不能为空"
        : duplicated.has(action)
          ? "与其它动作的组合键重复"
          : !this.handlers.has(action)
            ? "缺少动作处理器"
            : null;
      if (error) {
        results[action] = { accelerator, success: false, error };
        invalid = true;
      }
    }
    if (invalid) {
      for (const action of changed) {
        results[action] ??= { accelerator: requested[action], success: false, error: "本次修改未生效" };
      }
      return results;
    }

    const previous = new Map<ShortcutAction, string>();
    for (const action of changed) {
      const accelerator = this.registered.get(action);
      if (accelerator) {
        previous.set(action, accelerator);
        globalShortcut.unregister(accelerator);
        this.registered.delete(action);
      }
    }

    let failed = false;
    for (const action of changed) {
      const accelerator = requested[action];
      try {
        if (!globalShortcut.register(accelerator, this.handlers.get(action)!)) {
          results[action] = { accelerator, success: false, error: "该组合键已被其它程序占用" };
          failed = true;
          break;
        }
        this.registered.set(action, accelerator);
        results[action] = { accelerator, success: true };
        logger.info("ShortcutService", `Registered ${SHORTCUT_ACTION_LABELS[action]}: ${accelerator}`);
      } catch (error) {
        results[action] = { accelerator, success: false, error: errorMessage(error) };
        failed = true;
        break;
      }
    }

    if (failed) {
      for (const action of changed) {
        const accelerator = this.registered.get(action);
        if (accelerator) globalShortcut.unregister(accelerator);
        this.registered.delete(action);
      }
      for (const [action, accelerator] of previous) {
        try {
          if (globalShortcut.register(accelerator, this.handlers.get(action)!)) {
            this.registered.set(action, accelerator);
          } else {
            logger.error("ShortcutService", `Failed to restore ${SHORTCUT_ACTION_LABELS[action]}: ${accelerator}`);
          }
        } catch (error) {
          logger.error("ShortcutService", `Failed to restore ${SHORTCUT_ACTION_LABELS[action]}: ${accelerator}`, error);
        }
      }
      for (const action of changed) {
        results[action] ??= { accelerator: requested[action], success: false, error: "本次修改未生效" };
        if (results[action].success) {
          results[action] = { accelerator: requested[action], success: false, error: "本次修改未生效" };
        }
      }
      return results;
    }

    for (const action of changed) this.configured.set(action, requested[action]);
    return results;
  }

  getConfigured(): ShortcutBindings {
    return Object.fromEntries(this.configured) as ShortcutBindings;
  }

  getRegistered(): ShortcutBindings {
    const bindings: ShortcutBindings = {};

    for (const [action, accelerator] of this.registered) {
      bindings[action] = accelerator;
    }

    return bindings;
  }

  private unregisterActions(): void {
    for (const accelerator of this.registered.values()) {
      globalShortcut.unregister(accelerator);
    }

    this.registered.clear();
  }

  /**
   * 注册一组动态快捷键（Overlay 清单声明）。
   *
   * 命名空间由调用方给出（当前为 "overlay"）；应用自带动作与其它 scope 已占用的组合键会被跳过并报告冲突。
   */
  registerDynamic(
    scope: string,
    bindings: Record<string, string>,
    onPress: (shortcutId: string) => void,
  ): DynamicShortcutResult[] {
    this.unregisterDynamic(scope);

    const reserved = new Set<string>();

    for (const accelerator of this.registered.values()) {
      reserved.add(canonicalAccelerator(accelerator));
    }

    for (const accelerators of this.dynamicScopes.values()) {
      for (const accelerator of accelerators.values()) {
        reserved.add(canonicalAccelerator(accelerator));
      }
    }

    const registered = new Map<string, string>();
    const results: DynamicShortcutResult[] = [];

    for (const [id, accelerator] of Object.entries(bindings)) {
      const value = accelerator?.trim() ?? "";

      if (!value) {
        results.push({ id, accelerator: value, success: false, error: "快捷键不能为空" });
        continue;
      }

      if (reserved.has(canonicalAccelerator(value))) {
        results.push({ id, accelerator: value, success: false, error: "与应用快捷键或其它 Overlay 冲突" });
        continue;
      }

      let success = false;

      try {
        success = globalShortcut.register(value, () => onPress(id));
      } catch {
        success = false;
      }

      if (!success) {
        results.push({ id, accelerator: value, success: false, error: "该组合键已被其它程序占用" });
        continue;
      }

      reserved.add(canonicalAccelerator(value));
      registered.set(id, value);
      results.push({ id, accelerator: value, success: true });
      logger.info("ShortcutService", `Registered dynamic shortcut ${scope}:${id}: ${value}`);
    }

    this.dynamicScopes.set(scope, registered);
    this.lastDynamicResults = results;

    return results;
  }

  unregisterDynamic(scope: string): void {
    const accelerators = this.dynamicScopes.get(scope);

    if (!accelerators) return;

    for (const accelerator of accelerators.values()) {
      globalShortcut.unregister(accelerator);
    }

    this.dynamicScopes.delete(scope);
  }

  /** 切换 Overlay / 退出前清空所有动态快捷键。 */
  unregisterAllDynamic(): void {
    for (const scope of [...this.dynamicScopes.keys()]) {
      this.unregisterDynamic(scope);
    }

    this.lastDynamicResults = [];
  }

  getLastDynamicResults(): DynamicShortcutResult[] {
    return this.lastDynamicResults;
  }

  unregisterAll(): void {
    this.unregisterAllDynamic();
    globalShortcut.unregisterAll();
    this.registered.clear();
    this.configured.clear();
  }
}

export const shortcutService = ShortcutService.getInstance();

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SHORTCUTS,
  acceleratorFromInput,
  canonicalAccelerator,
  findDuplicateBindings,
  formatAccelerator,
} from "../../../shared/shortcuts.ts";

const baseInput = {
  code: "KeyI",
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
};

test("acceleratorFromInput: Ctrl+Alt+字母", () => {
  const result = acceleratorFromInput({ ...baseInput, key: "i", ctrlKey: true, altKey: true });
  assert.equal(result, "CommandOrControl+Alt+I");
});

test("acceleratorFromInput: 支持单独用 Shift 配合字母或数字键", () => {
  assert.equal(acceleratorFromInput({ ...baseInput, key: "I", shiftKey: true }), "Shift+I");
  assert.equal(
    acceleratorFromInput({ ...baseInput, key: "!", code: "Digit1", shiftKey: true }),
    "Shift+1",
  );
});

test("acceleratorFromInput: 裸键和单独的修饰键不形成快捷键", () => {
  assert.equal(acceleratorFromInput({ ...baseInput, key: "i" }), null);
  assert.equal(acceleratorFromInput({ ...baseInput, key: "Shift", shiftKey: true }), null);
});

test("acceleratorFromInput: 支持功能键与空格，忽略未知键", () => {
  assert.equal(
    acceleratorFromInput({ ...baseInput, key: "F5", code: "F5", ctrlKey: true }),
    "CommandOrControl+F5",
  );
  assert.equal(
    acceleratorFromInput({ ...baseInput, key: " ", code: "Space", ctrlKey: true }),
    "CommandOrControl+Space",
  );
  assert.equal(
    acceleratorFromInput({ ...baseInput, key: ",", code: "Comma", ctrlKey: true }),
    null,
  );
});

test("formatAccelerator: 生成展示文本", () => {
  assert.equal(formatAccelerator("CommandOrControl+Alt+M"), "Ctrl + Alt + M");
  assert.equal(formatAccelerator("Super+Shift+K"), "Super + Shift + K");
  assert.equal(formatAccelerator(""), "");
});

test("findDuplicateBindings: 忽略大小写与空格差异", () => {
  const duplicated = findDuplicateBindings({
    overlayRefresh: "CommandOrControl+Alt+I",
    overlayToggleMouseEvents: "commandorcontrol + alt + i",
  });

  assert.equal(duplicated.size, 1);
  assert.deepEqual(duplicated.get(canonicalAccelerator("CommandOrControl+Alt+I")), [
    "overlayRefresh",
    "overlayToggleMouseEvents",
  ]);
});

test("findDuplicateBindings: 不重复时返回空集合", () => {
  const duplicated = findDuplicateBindings({
    overlayRefresh: "CommandOrControl+Alt+I",
    overlayToggleMouseEvents: "CommandOrControl+Alt+M",
  });

  assert.equal(duplicated.size, 0);
});

test("导播地图快捷键与已有动作不同，且不占用数字切人键", () => {
  assert.equal(findDuplicateBindings(DEFAULT_SHORTCUTS).size, 0);
  assert.equal(DEFAULT_SHORTCUTS.directorMapToggle, "CommandOrControl+Alt+D");
  assert.ok(!/\+\d$/.test(DEFAULT_SHORTCUTS.directorMapToggle));
});

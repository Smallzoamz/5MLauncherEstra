import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initClientGuard,
  isAllowedDesktopOrigin,
  isEditableTarget,
  isInspectShortcut
} from '../src/services/clientGuard.js';

test('clientGuard validates allowed desktop origins strictly', () => {
  assert.equal(isAllowedDesktopOrigin('tauri:', 'localhost'), true);
  assert.equal(isAllowedDesktopOrigin('https:', 'tauri.localhost'), true);
  assert.equal(isAllowedDesktopOrigin('http:', 'tauri.localhost'), true);
  assert.equal(isAllowedDesktopOrigin('https:', 'evil.example'), false);
  assert.equal(isAllowedDesktopOrigin('http:', '127.0.0.1'), false);
  assert.equal(isAllowedDesktopOrigin('file:', ''), false);
});

test('clientGuard detects inspect shortcuts without false positives', () => {
  assert.equal(isInspectShortcut({ key: 'F12' }), true);
  assert.equal(isInspectShortcut({ key: 'i', ctrlKey: true, shiftKey: true }), true);
  assert.equal(isInspectShortcut({ key: 'J', ctrlKey: true, shiftKey: true }), true);
  assert.equal(isInspectShortcut({ key: 'C', metaKey: true, shiftKey: true }), true);
  assert.equal(isInspectShortcut({ key: 'u', ctrlKey: true }), true);
  assert.equal(isInspectShortcut({ key: 's', ctrlKey: true }), true);
  assert.equal(isInspectShortcut({ key: 'c', ctrlKey: true }), false);
  assert.equal(isInspectShortcut({ key: 'v', ctrlKey: true }), false);
  assert.equal(isInspectShortcut({ key: 'r', ctrlKey: true }), false);
});

test('clientGuard preserves editable targets for context menu', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableTarget({ tagName: 'textarea' }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: false }), false);
  assert.equal(isEditableTarget(null), false);
});

test('initClientGuard blocks iframe embedding and untrusted Tauri origins in production', () => {
  const mkDoc = () => {
    const listeners = {};
    return {
      listeners,
      documentElement: { textContent: 'app' },
      addEventListener(type, fn) {
        listeners[type] = fn;
      },
      removeEventListener(type) {
        delete listeners[type];
      }
    };
  };

  // Non-prod stays inactive
  const devDoc = mkDoc();
  assert.deepEqual(
    initClientGuard({ isProd: false, win: { estraWindow: {} }, doc: devDoc }),
    { active: false, blocked: false }
  );

  // Iframe embed is blocked
  const frameDoc = mkDoc();
  const fakeParent = {};
  const framed = initClientGuard({
    isProd: true,
    win: { estraWindow: {}, self: {}, top: fakeParent },
    doc: frameDoc
  });
  assert.equal(framed.blocked, true);
  assert.equal(framed.reason, 'frame');
  assert.equal(frameDoc.documentElement.textContent, '');

  // Untrusted __TAURI_INTERNALS__ origin is blocked
  const evilDoc = mkDoc();
  const selfWin = {
    estraWindow: {},
    __TAURI_INTERNALS__: {},
    location: { protocol: 'https:', hostname: 'clone.evil' }
  };
  selfWin.self = selfWin;
  selfWin.top = selfWin;
  const evilRes = initClientGuard({ isProd: true, win: selfWin, doc: evilDoc });
  assert.equal(evilRes.blocked, true);
  assert.equal(evilRes.reason, 'origin');
  assert.equal(evilDoc.documentElement.textContent, '');

  // Trusted production Tauri window activates listeners and disables React DevTools hook
  const goodDoc = mkDoc();
  const goodWin = {
    estraWindow: {},
    __TAURI_INTERNALS__: {},
    location: { protocol: 'https:', hostname: 'tauri.localhost' }
  };
  goodWin.self = goodWin;
  goodWin.top = goodWin;
  const goodRes = initClientGuard({ isProd: true, win: goodWin, doc: goodDoc });
  assert.equal(goodRes.active, true);
  assert.equal(goodRes.blocked, false);
  assert.equal(goodWin.__REACT_DEVTOOLS_GLOBAL_HOOK__.isDisabled, true);

  let prevented = false;
  goodDoc.listeners.contextmenu({ target: { tagName: 'DIV' }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);

  let inputPrevented = false;
  goodDoc.listeners.contextmenu({ target: { tagName: 'INPUT' }, preventDefault: () => { inputPrevented = true; } });
  assert.equal(inputPrevented, false);

  let keyPrevented = false;
  let keyStopped = false;
  goodDoc.listeners.keydown({
    key: 'I',
    ctrlKey: true,
    shiftKey: true,
    preventDefault: () => { keyPrevented = true; },
    stopPropagation: () => { keyStopped = true; }
  });
  assert.equal(keyPrevented, true);
  assert.equal(keyStopped, true);

  goodRes.cleanup();
});

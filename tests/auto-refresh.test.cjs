const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../package/contents/ui/main.qml'), 'utf8');

// Execute the actual QML JavaScript against deterministic timer/network doubles.
function block(marker) {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, marker);
    const open = source.indexOf('{', start);
    let depth = 1, end = open + 1;
    for (; depth; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    return source.slice(open + 1, end - 1);
}
function context(autoRefresh = false) {
    const counts = { starts: 0, stops: 0, selections: 0, restored: 0 };
    const queued = [];
    const ctx = vm.createContext({
        autoRefresh, componentReady: true, synchronizeScreens: false,
        isLoading: false, followSystemTheme: true,
        main: { configuration: { UseSavedWallpapers: false } },
        refreshTimer: { start() { counts.starts++; }, stop() { counts.stops++; } },
        Qt: { callLater(fn) { queued.push(fn); } },
        log() {},
        loadStartupCache() { counts.restored++; },
        registerWithSyncGroup() { return null; },
        produceWallpaperSelection() { counts.selections++; return Promise.resolve({url: 'chosen.jpg'}); },
        applyWallpaperSelection() {}, handleRefreshError() {}
    });
    for (const name of ['scheduleNextRefresh', 'requestAutomaticRefresh', 'refreshImage'])
        vm.runInContext('function ' + name + '() {' + block('function ' + name + '(') + '}', ctx);
    return { ctx, counts, queued };
}
test('manual startup restores cache without searching', () => {
    const {ctx, counts, queued} = context();
    vm.runInContext(block('Component.onCompleted:'), ctx);
    queued.forEach(fn => fn());
    assert.equal(counts.restored, 1);
    assert.equal(counts.selections, 0);
    assert.equal(counts.starts, 0);
});
test('automatic startup still selects a wallpaper', () => {
    const {ctx, counts, queued} = context(true);
    vm.runInContext(block('Component.onCompleted:'), ctx);
    queued.forEach(fn => fn());
    assert.equal(counts.selections, 1);
});
test('switch stops a running timer and re-enabling schedules it', () => {
    const {ctx, counts} = context();
    vm.runInContext(block('onAutoRefreshChanged:'), ctx);
    assert.equal(counts.stops, 1);
    assert.equal(counts.starts, 0);
    ctx.autoRefresh = true;
    vm.runInContext(block('onAutoRefreshChanged:'), ctx);
    assert.equal(counts.starts, 1);
});
test('queued timer callback cannot search after switch is disabled', () => {
    const {ctx, counts} = context(true);
    const pending = ctx.requestAutomaticRefresh;
    ctx.autoRefresh = false;
    pending();
    assert.equal(counts.selections, 0);
});
test('manual refresh signal searches with automatic refresh disabled', () => {
    const {ctx, counts} = context();
    vm.runInContext(block('onRefreshSignalChanged:'), ctx);
    assert.equal(counts.selections, 1);
});
test('theme changes do not select in manual mode', () => {
    const {ctx, counts} = context();
    vm.runInContext(block('onSystemDarkModeChanged:'), ctx);
    ctx.requestAutomaticRefresh();
    assert.equal(counts.selections, 0);
});
test('manual mode suspends screen synchronization', () => {
    const expression = source.match(/readonly property bool synchronizeScreens: (.*)/)[1];
    const {ctx} = context();
    ctx.main.configuration.SynchronizeScreens = true;
    assert.equal(vm.runInContext(expression, ctx), false);
    ctx.autoRefresh = true;
    assert.equal(vm.runInContext(expression, ctx), true);
});

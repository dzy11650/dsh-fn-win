'use strict';

// DeepSeek Harness — Windows desktop shell.
//
// Electron is ONLY a shell here: a system tray + a bundled Node runtime that
// spawns `dsh web`. We deliberately do NOT reuse Electron's bundled Node to
// run DSH, because:
//   * DSH requires Node >= 22.19 (it calls node:util styleText).
//   * Electron 37's embedded Node is 22.16 — too old, would crash on boot.
// So we ship an independent Node 24 binary in resources/node and spawn from it.

const { app, BrowserWindow, Tray, Menu, shell, Notification } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { URL } = require('url');

const DSH_PORT = 3080;
const DSH_HOST = '127.0.0.1';
const DSH_URL = `http://${DSH_HOST}:${DSH_PORT}`;

// --- single instance lock --------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance is already running; quit this one.
  app.quit();
  process.exit(0);
}

let tray = null;
let win = null;
let dshProcess = null;
let dshReady = false;
let probeTimer = null;

// --- helpers ---------------------------------------------------------------

function resourcesNode() {
  // Bundled Node 24. On Windows the binary is node.exe.
  const base = path.join(process.resourcesPath, 'node');
  return process.platform === 'win32' ? path.join(base, 'node.exe') : path.join(base, 'node');
}

function dshRoot() {
  return path.join(process.resourcesPath, 'dsh');
}

function logPath() {
  const p = path.join(app.getPath('userData'), 'dsh.log');
  return p;
}

function startDsh() {
  if (dshProcess) return;

  const nodeBin = resourcesNode();
  const bin = path.join(dshRoot(), 'apps', 'cli', 'src', 'bin.ts');
  const dshHome = path.join(app.getPath('userData'), 'dsh-home');

  const env = { ...process.env, DSH_HOME: dshHome, DSH_WEB_HOST: DSH_HOST, DSH_WEB_PORT: String(DSH_PORT) };

  // `node --experimental-strip-types bin.ts web --no-open`
  //   --experimental-strip-types -> Node 24 runs .ts directly (no tsx/esbuild).
  //   --no-open  -> DSH must NOT spawn its own system browser.
  //   --host/--port -> bind loopback so only this machine reaches it.
  dshProcess = spawn(nodeBin, [
    '--experimental-strip-types',
    bin, 'web',
    '--no-open',
    '--host', DSH_HOST,
    '--port', String(DSH_PORT),
  ], { env, cwd: dshRoot(), windowsHide: true });

  const log = logPath();
  dshProcess.stdout.on('data', d => fs.appendFileSync(log, `[out] ${d}`));
  dshProcess.stderr.on('data', d => fs.appendFileSync(log, `[err] ${d}`));
  dshProcess.on('exit', (code, signal) => {
    fs.appendFileSync(log, `[exit] code=${code} signal=${signal}\n`);
    dshProcess = null;
    dshReady = false;
    // Auto-restart once on crash.
    if (code !== 0 && code !== null) {
      setTimeout(startDsh, 2000);
    }
  });

  startProbe();
}

function startProbe() {
  if (probeTimer) clearInterval(probeTimer);
  probeTimer = setInterval(() => {
    const req = http.get(`${DSH_URL}/`, res => {
      res.resume();
      if (!dshReady && res.statusCode < 500) {
        dshReady = true;
        if (win) win.loadURL(DSH_URL);
        tray?.setToolTip('DeepSeek Harness — 运行中');
      }
    });
    req.on('error', () => { /* not ready yet */ });
    req.setTimeout(1000, () => req.destroy());
  }, 1500);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('close', e => {
    // Minimize to tray instead of quitting — DSH should keep running.
    if (dshProcess) {
      e.preventDefault();
      win.hide();
    }
  });

  if (dshReady) win.loadURL(DSH_URL);
  else win.loadFile(path.join(__dirname, 'renderer', 'loading.html'));
}

function buildTray() {
  tray = new Tray(path.join(process.resourcesPath, 'icon.png'));
  const ctx = Menu.buildFromTemplate([
    { label: '打开 DeepSeek Harness', click: () => { if (!win) createWindow(); win.show(); win.loadURL(dshReady ? DSH_URL : path.join(__dirname, 'renderer', 'loading.html')); } },
    { label: '查看日志', click: () => shell.openPath(logPath()) },
    { type: 'separator' },
    { label: '开机自启', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: '退出', click: () => { stopDsh(); app.quit(); } },
  ]);
  tray.setToolTip('DeepSeek Harness');
  tray.setContextMenu(ctx);
  tray.on('click', () => { if (!win) createWindow(); win.show(); });
}

function stopDsh() {
  if (probeTimer) clearInterval(probeTimer);
  if (dshProcess) { dshProcess.kill('SIGTERM'); dshProcess = null; }
}

// --- lifecycle -------------------------------------------------------------

app.whenReady().then(() => {
  createWindow();
  buildTray();
  startDsh();
});

app.on('second-instance', () => { if (win) { win.show(); } });

app.on('before-quit', () => { stopDsh(); });

app.on('window-all-closed', () => { /* keep running in tray */ });

// WaterQuiet Electron 主进程
// 职责：
//  1. 创建游戏窗口，加载 dist/index.html
//  2. 关闭混合内容限制：让游戏（file:// 加载）能直连 ws:// 服务器，
//     从而绕开浏览器「https 页面只能 wss」的限制，去掉 Cloudflare 中继。
//  3. 提供最小菜单（刷新/开发者工具/退出）

const { app, BrowserWindow, session, Menu } = require('electron');
const nodePath = require('node:path');

// —— 启动日志（写多个位置；失败不抛出）——
const fs = require('node:fs');
const LOG_PATHS = [
  nodePath.join(process.env.APPDATA || '', 'WaterQuiet', 'main.log'),
  nodePath.join(process.env.TEMP || '', 'waterquiet-main.log'),
];
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  for (const p of LOG_PATHS) {
    try {
      fs.mkdirSync(nodePath.dirname(p), { recursive: true });
      fs.appendFileSync(p, line);
    } catch {}
  }
}
log('MAIN BOOT');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'WaterQuiet（水寂）',
    backgroundColor: '#0a1326',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on('render-process-gone', (_e, d) => log('render-gone ' + JSON.stringify(d)));
  win.webContents.on('did-fail-load', (_e, c, desc) => log('fail-load ' + c + ' ' + desc));
  win.webContents.on('console-message', (_e, _l, m) => log('console ' + String(m).slice(0, 200)));

  win.loadFile(nodePath.join(__dirname, '..', 'dist', 'index.html'))
    .then(() => log('loadFile OK'))
    .catch((e) => log('loadFile FAIL ' + (e && e.message)));

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(() => {
  log('whenReady');
  // 混合内容放行：允许 file:// 页面连 ws://（绕开浏览器 wss 限制的关键）
  session.defaultSession.setPermissionCheckHandler(() => true);

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '游戏',
        submenu: [
          { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => BrowserWindow.getFocusedWindow()?.reload() },
          { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', click: () => BrowserWindow.getFocusedWindow()?.webContents.openDevTools() },
          { type: 'separator' },
          { label: '退出', role: 'quit' },
        ],
      },
    ]),
  );

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  log('window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});
process.on('before-quit', () => log('before-quit'));
process.on('will-quit', () => log('will-quit'));
process.on('uncaughtException', (err) => log('uncaught ' + (err && err.stack)));

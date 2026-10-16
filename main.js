const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('./store.js');

let store = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;

process.on('uncaughtException', (e) => {
  try {
    fs.writeFileSync(path.join(app.getPath('temp'), 'crash.log'), new Date().toISOString() + '\n' + (e && e.stack ? e.stack : String(e)));
  } catch (_) {}
});

const PRESET_CATEGORIES = [
  { type: 'expense', name: '餐饮' },
  { type: 'expense', name: '交通' },
  { type: 'expense', name: '购物' },
  { type: 'expense', name: '娱乐' },
  { type: 'expense', name: '居住' },
  { type: 'expense', name: '医疗' },
  { type: 'expense', name: '学习' },
  { type: 'expense', name: '其他' },
  { type: 'income', name: '工资' },
  { type: 'income', name: '奖金' },
  { type: 'income', name: '理财' },
  { type: 'income', name: '兼职' },
  { type: 'income', name: '其他' }
];

function getDefaultDataDir() {
  return __dirname;
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(path.join(app.getPath('userData'), 'config.json'), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {}
}

function resolveDataDir() {
  const cfg = loadConfig();
  if (cfg && cfg.dataDir) return cfg.dataDir;

  const defaultDir = getDefaultDataDir();
  if (fs.existsSync(path.join(defaultDir, 'data.json'))) return defaultDir;

  // 便携模式：数据默认放在程序所在文件夹（如 D:\记账本），不依赖 C 盘，也不弹窗询问
  saveConfig({ dataDir: defaultDir });
  return defaultDir;
}

function ensureWritable(dir) {
  const probe = path.join(dir, '.write_test');
  try {
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false;
  }
}

function initStore() {
  if (store) return;
  let dir = resolveDataDir();
  if (!ensureWritable(dir)) {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: '数据目录无写权限',
      message: `当前目录没有写权限：\n${dir}\n\n请选择一个可以写入数据的文件夹（比如 D 盘），数据库文件将保存在那里。`,
      buttons: ['选择文件夹', '退出'],
      defaultId: 0,
      cancelId: 1
    });
    if (choice !== 0) {
      app.quit();
      return;
    }
    const picked = dialog.showOpenDialogSync(mainWindow, {
      title: '选择数据存放目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (!picked || !picked[0]) {
      app.quit();
      return;
    }
    dir = picked[0];
  }
  store = new Store(path.join(dir, 'data.json'));
  store.init(PRESET_CATEGORIES);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: '记账本',
    show: false,
    backgroundColor: '#edf0f3',
    icon: fs.existsSync(path.join(__dirname, 'build', 'icon.ico')) ? path.join(__dirname, 'build', 'icon.ico') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // 点右上角关闭 = 收进托盘后台，不退出；托盘右键「退出」才真正结束
  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  const img = nativeImage.createFromPath(iconPath);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('记账本');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开记账本', click: showMain },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]));
  tray.on('click', showMain);
}

function showMain() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
}

function registerIpc() {
  ipcMain.handle('categories:list', () => store.getCategories());
  ipcMain.handle('categories:add', (e, { type, name }) => store.addCategory(type, name));
  ipcMain.handle('categories:rename', (e, { id, name }) => store.renameCategory(id, name));
  ipcMain.handle('categories:remove', (e, id) => {
    const inUse = store.categoryRecordCount(id);
    if (inUse > 0) return { ok: false, inUse };
    store.removeCategory(id);
    return { ok: true };
  });
  ipcMain.handle('categories:setBudget', (e, { id, budget }) => store.setCategoryBudget(id, budget));

  ipcMain.handle('records:add', (e, record) => store.addRecord(record));
  ipcMain.handle('records:update', (e, { id, record }) => store.updateRecord(id, record));
  ipcMain.handle('records:remove', (e, id) => {
    store.removeRecord(id);
    return true;
  });
  ipcMain.handle('records:list', (e, filter) => store.listRecords(filter));

  ipcMain.handle('goal:get', () => store.getGoal());
  ipcMain.handle('goal:set', (e, target) => store.setGoal(target));

  ipcMain.handle('stats:monthly', (e, { year, month }) => store.monthlyStats(year, month));
  ipcMain.handle('stats:year', (e, year) => store.yearStats(year));
  ipcMain.handle('stats:daily', (e, { year, month }) => store.dailyStats(year, month));
  ipcMain.handle('stats:net', () => store.netStats());
  ipcMain.handle('stats:budget', (e, { year, month }) => store.budgetStats(year, month));
}

app.whenReady().then(() => {
  initStore();
  if (store) {
    createWindow();
    registerIpc();
    createTray();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
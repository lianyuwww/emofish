const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listCategories: () => ipcRenderer.invoke('categories:list'),
  addCategory: (data) => ipcRenderer.invoke('categories:add', data),
  renameCategory: (data) => ipcRenderer.invoke('categories:rename', data),
  removeCategory: (id) => ipcRenderer.invoke('categories:remove', id),
  setCategoryBudget: (data) => ipcRenderer.invoke('categories:setBudget', data),

  addRecord: (record) => ipcRenderer.invoke('records:add', record),
  updateRecord: (data) => ipcRenderer.invoke('records:update', data),
  removeRecord: (id) => ipcRenderer.invoke('records:remove', id),
  listRecords: (filter) => ipcRenderer.invoke('records:list', filter),

  monthlyStats: (range) => ipcRenderer.invoke('stats:monthly', range),
  yearStats: (year) => ipcRenderer.invoke('stats:year', year),
  dailyStats: ({ year, month }) => ipcRenderer.invoke('stats:daily', { year, month }),
  netStats: () => ipcRenderer.invoke('stats:net'),
  budgetStats: ({ year, month }) => ipcRenderer.invoke('stats:budget', { year, month }),

  getGoal: () => ipcRenderer.invoke('goal:get'),
  setGoal: (target) => ipcRenderer.invoke('goal:set', target)
});
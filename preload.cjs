const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Cau noi an toan giua giao dien (renderer) va tien trinh chinh (main).
contextBridge.exposeInMainWorld("api", {
  // Cau hinh OAuth client
  hasClient: () => ipcRenderer.invoke("auth:hasClient"),
  saveClient: (clientId, clientSecret) =>
    ipcRenderer.invoke("auth:saveClient", { clientId, clientSecret }),

  // Khoa ma hoa (mat khau)
  keyExists: () => ipcRenderer.invoke("key:exists"),
  keyInit: (password) => ipcRenderer.invoke("key:init", password),
  keyUnlock: (password) => ipcRenderer.invoke("key:unlock", password),
  isUnlocked: () => ipcRenderer.invoke("key:isUnlocked"),

  // Tai khoan
  listAccounts: () => ipcRenderer.invoke("accounts:list"),
  connectAccount: () => ipcRenderer.invoke("accounts:connect"),
  disconnectAccount: (id) => ipcRenderer.invoke("accounts:disconnect", id),

  // Lay duong dan that cua file keo-tha (Electron 32+ bo file.path)
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // File & thu muc
  listFiles: () => ipcRenderer.invoke("files:list"),
  listDir: (dir) => ipcRenderer.invoke("fs:listDir", dir),
  createFolder: (dir, name) => ipcRenderer.invoke("fs:createFolder", { dir, name }),
  renameFolder: (dir, newName) => ipcRenderer.invoke("fs:renameFolder", { dir, newName }),
  removeFolder: (dir) => ipcRenderer.invoke("fs:removeFolder", dir),
  pickFiles: () => ipcRenderer.invoke("dialog:pickFiles"),
  uploadOne: (filePath, dir, uploadId) => ipcRenderer.invoke("files:uploadOne", { filePath, dir, uploadId }),
  cancelUpload: (uploadId) => ipcRenderer.invoke("files:cancelUpload", uploadId),
  download: (id) => ipcRenderer.invoke("files:download", id),
  preview: (id) => ipcRenderer.invoke("files:preview", id),
  open: (id) => ipcRenderer.invoke("files:open", id),
  remove: (id) => ipcRenderer.invoke("files:remove", id),
  rename: (id, newName) => ipcRenderer.invoke("files:rename", { id, newName }),
  move: (id, dir) => ipcRenderer.invoke("files:move", { id, dir }),

  // Thung rac
  listTrash: () => ipcRenderer.invoke("trash:list"),
  restore: (id) => ipcRenderer.invoke("files:restore", id),
  deleteForever: (id) => ipcRenderer.invoke("files:deleteForever", id),
  emptyTrash: () => ipcRenderer.invoke("trash:empty"),

  // Nhan su kien tien trinh tu main
  onProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("progress", listener);
    return () => ipcRenderer.removeListener("progress", listener);
  },
  onToast: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("toast", listener);
    return () => ipcRenderer.removeListener("toast", listener);
  },
});

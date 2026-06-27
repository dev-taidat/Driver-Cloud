const { contextBridge, ipcRenderer } = require("electron");

// Ban WEB chay trong app desktop. CHI expose window.dcDesktop.
// (KHONG expose window.api - se dung ten voi `const api` trong web app.js -> SyntaxError lam chet ca trang.)
// Cau noi mo file de SUA: tai ve -> mo editor -> luu la tu dong bo len cloud.
// Trang web kiem tra window.dcDesktop?.isDesktop de hien nut.
contextBridge.exposeInMainWorld("dcDesktop", {
  isDesktop: true,
  edit: (id, name, dir) => ipcRenderer.invoke("edit:open", { id, name, dir }),
});

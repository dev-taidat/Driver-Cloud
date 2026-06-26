window.onerror = (m, s, l) => console.error("ERR:", m, s, l);
window.addEventListener("unhandledrejection", (e) => console.error("REJECT:", e.reason && (e.reason.message || e.reason)));

const dc = window.api;
const $ = (id) => document.getElementById(id);
if (!dc) document.body.innerHTML = '<p style="padding:40px">Loi: preload khong nap.</p>';

let currentDir = "/";
let searchQuery = "";
let view = "drive"; // 'drive' | 'trash'

function human(b) {
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function iconFor(name) {
  const e = (name.split(".").pop() || "").toLowerCase();
  if (["png","jpg","jpeg","gif","webp","bmp","svg","heic"].includes(e)) return "🖼️";
  if (["mp4","mkv","avi","mov","webm","flv"].includes(e)) return "🎬";
  if (["mp3","wav","flac","aac","ogg"].includes(e)) return "🎵";
  if (["zip","rar","7z","tar","gz"].includes(e)) return "🗜️";
  if (["pdf"].includes(e)) return "📕";
  if (["doc","docx","txt","rtf"].includes(e)) return "📄";
  if (["xls","xlsx","csv"].includes(e)) return "📊";
  if (["exe","msi"].includes(e)) return "⚙️";
  return "📦";
}

// ===== Dieu huong =====
async function route() {
  const hasClient = await dc.hasClient();
  if (!hasClient) { show($("setup")); hide($("app")); return; }
  hide($("setup")); show($("app"));
  await render();
  refreshStorage();
}
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

$("saveClient").onclick = async () => {
  const id = $("clientId").value.trim(), sec = $("clientSecret").value.trim();
  if (!id || !sec) return ($("setupErr").textContent = "Hay nhap day du.");
  await dc.saveClient(id, sec);
  route();
};

// ===== Render noi dung =====
async function render() {
  if (view === "trash") return renderTrash();
  if (searchQuery) return renderSearch();
  const { folders, files } = await dc.listDir(currentDir);
  renderCrumbs();
  const fdiv = $("folders"), xdiv = $("files");
  fdiv.innerHTML = ""; xdiv.innerHTML = "";

  $("foldersSection").classList.toggle("hidden", folders.length === 0);
  $("filesSection").classList.toggle("hidden", files.length === 0);
  $("emptyHint").querySelector("p").innerHTML = "Thư mục trống. Kéo-thả tệp vào đây hoặc bấm <b>＋ Mới</b>.";
  $("emptyHint").classList.toggle("hidden", folders.length + files.length > 0);

  for (const path of folders) fdiv.appendChild(folderCard(path));
  for (const f of files) xdiv.appendChild(fileCard(f));
}

async function renderSearch() {
  const all = await dc.listFiles();
  const q = searchQuery.toLowerCase();
  const matched = all.filter((f) => f.name.toLowerCase().includes(q));
  $("crumbs").innerHTML = `<span class="crumb last">Kết quả cho "${searchQuery}" (${matched.length})</span>`;
  $("foldersSection").classList.add("hidden");
  $("filesSection").classList.remove("hidden");
  $("emptyHint").classList.toggle("hidden", matched.length > 0);
  const xdiv = $("files"); xdiv.innerHTML = "";
  for (const f of matched) xdiv.appendChild(fileCard(f, true));
}

function renderCrumbs() {
  const box = $("crumbs"); box.innerHTML = "";
  const parts = currentDir === "/" ? [] : currentDir.split("/").filter(Boolean);
  const root = document.createElement("span");
  root.className = "crumb" + (parts.length === 0 ? " last" : "");
  root.textContent = "Drive của tôi";
  root.onclick = () => navTo("/");
  box.appendChild(root);
  let acc = "";
  parts.forEach((p, i) => {
    acc += "/" + p;
    const sep = document.createElement("span"); sep.className = "crumb-sep"; sep.textContent = "›"; box.appendChild(sep);
    const c = document.createElement("span");
    c.className = "crumb" + (i === parts.length - 1 ? " last" : "");
    c.textContent = p;
    const target = acc;
    if (i !== parts.length - 1) c.onclick = () => navTo(target);
    box.appendChild(c);
  });
}

function navTo(dir) { view = "drive"; setActiveNav(); currentDir = dir; render(); }

function setActiveNav() {
  $("navMyDrive").classList.toggle("active", view === "drive");
  $("navTrash").classList.toggle("active", view === "trash");
}
$("navMyDrive").onclick = () => { view = "drive"; searchQuery = ""; $("search").value = ""; hide($("searchClear")); setActiveNav(); render(); };
$("navTrash").onclick = () => { view = "trash"; setActiveNav(); render(); };

async function renderTrash() {
  const files = await dc.listTrash();
  const box = $("crumbs"); box.innerHTML = "";
  const t = document.createElement("span"); t.className = "crumb last"; t.textContent = "Thùng rác"; box.appendChild(t);
  if (files.length > 0) {
    const btn = document.createElement("button");
    btn.className = "btn-primary"; btn.style.marginLeft = "16px"; btn.style.fontSize = "13px"; btn.style.padding = "6px 14px";
    btn.textContent = "Dọn sạch thùng rác";
    btn.onclick = async () => { if (confirm("Xóa vĩnh viễn TẤT CẢ file trong thùng rác? Không thể hoàn tác.")) { await dc.emptyTrash(); render(); refreshStorage(); } };
    box.appendChild(btn);
  }
  $("foldersSection").classList.add("hidden");
  $("filesSection").classList.remove("hidden");
  $("emptyHint").classList.toggle("hidden", files.length > 0);
  if (files.length === 0) $("emptyHint").querySelector("p").innerHTML = "Thùng rác trống.";
  const xdiv = $("files"); xdiv.innerHTML = "";
  for (const f of files) xdiv.appendChild(trashCard(f));
}

function trashCard(f) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `<span class="ic">${iconFor(f.name)}</span><div class="nm"><div class="t">${escapeHtml(f.name)}</div><div class="s">${human(f.size)}</div></div><span class="more">⋮</span>`;
  const menu = (e) => { e.preventDefault(); e.stopPropagation(); showCtx(e, [
    { icon: "♻️", label: "Khôi phục", fn: async () => { await dc.restore(f.id); render(); refreshStorage(); } },
    { icon: "🗑️", label: "Xóa vĩnh viễn", danger: true, fn: async () => { if (confirm(`Xóa vĩnh viễn "${f.name}"?`)) { await dc.deleteForever(f.id); render(); refreshStorage(); } } },
  ]); };
  el.querySelector(".more").onclick = menu;
  el.oncontextmenu = menu;
  return el;
}

// ===== Card =====
function folderCard(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `<span class="ic">📁</span><div class="nm"><div class="t">${escapeHtml(name)}</div></div><span class="more">⋮</span>`;
  el.ondblclick = () => navTo(path);
  el.querySelector(".more").onclick = (e) => { e.stopPropagation(); folderMenu(e, path, name); };
  el.oncontextmenu = (e) => { e.preventDefault(); folderMenu(e, path, name); };
  return el;
}

function fileCard(f, showPath) {
  const el = document.createElement("div");
  el.className = "card";
  const acc = f.account ? ` · ${escapeHtml(f.account.split("@")[0])}` : "";
  const sub = showPath
    ? escapeHtml(f.dir)
    : human(f.size) + acc + (f.complete ? "" : ' · <span class="wip">chưa xong</span>');
  const ic = f.thumb
    ? `<img class="thumb" src="${f.thumb}" alt="">`
    : `<span class="ic">${iconFor(f.name)}</span>`;
  el.innerHTML = `${ic}<div class="nm"><div class="t">${escapeHtml(f.name)}</div><div class="s">${sub}</div></div><span class="more">⋮</span>`;
  el.querySelector(".more").onclick = (e) => { e.stopPropagation(); fileMenu(e, f); };
  el.oncontextmenu = (e) => { e.preventDefault(); fileMenu(e, f); };
  el.ondblclick = () => f.complete && openPreview(f);
  el.title = f.account ? `Tài khoản: ${f.account}` : "";
  return el;
}

// ===== Trinh xem trong app =====
let viewerFile = null;
async function openPreview(f) {
  viewerFile = f;
  $("viewerTitle").textContent = f.name;
  $("viewerBody").innerHTML = '<div class="viewer-loading">Đang tải để xem…</div>';
  show($("viewer"));
  let r;
  try { r = await dc.preview(f.id); }
  catch (e) { hide($("viewer")); return toast({ type: "error", message: "Loi: " + (e.message || e) }); }
  if (r.kind === "other") { hide($("viewer")); dc.open(f.id); return; } // mo bang app ngoai
  const src = `dcmedia://m/${encodeURIComponent(r.name)}?t=${Date.now()}`;
  $("viewerBody").innerHTML = r.kind === "image"
    ? `<img src="${src}">`
    : `<video src="${src}" controls autoplay></video>`;
}
function closeViewer() { hide($("viewer")); $("viewerBody").innerHTML = ""; viewerFile = null; }
$("viewerClose").onclick = closeViewer;
$("viewer").onclick = (e) => { if (e.target === $("viewer")) closeViewer(); };
$("viewerOpen").onclick = () => viewerFile && dc.open(viewerFile.id);
$("viewerDownload").onclick = () => viewerFile && dc.download(viewerFile.id);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("viewer").classList.contains("hidden")) closeViewer(); });

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ===== Context menu =====
function showCtx(e, items) {
  const m = $("ctxMenu");
  m.innerHTML = "";
  for (const it of items) {
    const d = document.createElement("div");
    d.className = "it" + (it.danger ? " danger" : "");
    d.innerHTML = `<span>${it.icon}</span> ${it.label}`;
    d.onclick = () => { hide(m); it.fn(); };
    m.appendChild(d);
  }
  m.style.left = Math.min(e.clientX, window.innerWidth - 200) + "px";
  m.style.top = Math.min(e.clientY, window.innerHeight - 160) + "px";
  show(m);
}
document.addEventListener("click", (e) => { if (!$("ctxMenu").contains(e.target)) hide($("ctxMenu")); });

function fileMenu(e, f) {
  showCtx(e, [
    { icon: "👁️", label: "Mở / Xem", fn: () => openPreview(f) },
    { icon: "⬇️", label: "Tải về máy", fn: () => dc.download(f.id) },
    { icon: "✏️", label: "Đổi tên", fn: () => renameItem(f) },
    { icon: "🗑️", label: "Xóa", danger: true, fn: () => delFile(f) },
  ]);
}
function folderMenu(e, path, name) {
  showCtx(e, [
    { icon: "📂", label: "Mở", fn: () => navTo(path) },
    { icon: "✏️", label: "Đổi tên", fn: async () => { const n = prompt("Tên mới:", name); if (n && n !== name) { await dc.renameFolder(path, n); render(); } } },
    { icon: "🗑️", label: "Xóa (cả nội dung)", danger: true, fn: async () => { if (confirm(`Xóa thư mục "${name}" và toàn bộ bên trong?`)) { await dc.removeFolder(path); render(); refreshStorage(); } } },
  ]);
}
async function renameItem(f) {
  const n = prompt("Tên mới:", f.name);
  if (n && n !== f.name) { await dc.rename(f.id, n); render(); }
}
async function delFile(f) {
  await dc.remove(f.id); // chuyen vao thung rac
  toast({ type: "ok", message: `Đã chuyển "${f.name}" vào thùng rác` });
  render(); refreshStorage();
}

// ===== Nut Moi =====
$("newBtn").onclick = (e) => { e.stopPropagation(); $("newMenu").classList.toggle("hidden"); };
document.addEventListener("click", () => hide($("newMenu")));
$("newMenu").onclick = async (e) => {
  const act = e.target.dataset.act;
  if (act === "folder") {
    const name = prompt("Tên thư mục:");
    if (name) { await dc.createFolder(currentDir, name); render(); }
  } else if (act === "upload") {
    const paths = await dc.pickFiles();
    doUpload(paths);
  }
};

// ===== Upload =====
let uploadSeq = 0;
async function doUpload(paths) {
  if (!paths || paths.length === 0) return;
  $("ppTitle").textContent = "Đang tải lên";
  for (const p of paths) {
    const uploadId = "u" + (++uploadSeq);
    const name = p.split(/[\\/]/).pop();
    const el = ensureRow(uploadId, name, () => dc.cancelUpload(uploadId));
    const r = await dc.uploadOne(p, currentDir, uploadId);
    if (r && r.ok) setRowDone(el);
    else if (r && r.canceled) setRowCanceled(el);
    else setRowDone(el, "Lỗi");
    render(); refreshStorage();
  }
}

const content = $("content");
let dragDepth = 0;
content.addEventListener("dragenter", (e) => { e.preventDefault(); if (dragDepth++ === 0) show($("dropOverlay")); });
content.addEventListener("dragover", (e) => e.preventDefault());
content.addEventListener("dragleave", (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; hide($("dropOverlay")); } });
content.addEventListener("drop", (e) => {
  e.preventDefault(); dragDepth = 0; hide($("dropOverlay"));
  const paths = [...e.dataTransfer.files].map((f) => { try { return dc.getPathForFile(f); } catch { return f.path; } }).filter(Boolean);
  if (paths.length === 0) return toast({ type: "error", message: "Khong lay duoc duong dan file." });
  doUpload(paths);
});

// ===== Tim kiem =====
$("search").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  $("searchClear").classList.toggle("hidden", !searchQuery);
  render();
});
$("searchClear").onclick = () => { $("search").value = ""; searchQuery = ""; hide($("searchClear")); render(); };

// ===== Storage & accounts =====
async function refreshStorage() {
  const accs = await dc.listAccounts();
  let free = 0, all = 0, used = 0;
  for (const a of accs) { free += a.freeBytes; all += a.totalBytes; used += a.usedBytes; }
  const pct = all > 0 ? (used / all) * 100 : 0;
  $("usedBar").style.width = pct + "%";
  $("storageText").textContent = `${human(used)} / ${human(all)} đã dùng`;
  return accs;
}

$("openAccounts").onclick = async () => {
  const accs = await refreshStorage();
  const list = $("accList"); list.innerHTML = "";
  let free = 0, all = 0;
  for (const a of accs) {
    free += a.freeBytes; all += a.totalBytes;
    const pct = a.totalBytes > 0 ? (a.usedBytes / a.totalBytes) * 100 : 0;
    const row = document.createElement("div");
    row.className = "acc-row";
    row.innerHTML = `<div class="em">${a.email}</div><div class="mini"><div style="width:${pct}%"></div></div><div class="r"><span class="muted small">còn ${human(a.freeBytes)} / ${human(a.totalBytes)}</span><button class="rm">Gỡ</button></div>`;
    row.querySelector(".rm").onclick = async () => { if (confirm(`Gỡ ${a.email}?`)) { await dc.disconnectAccount(a.id); $("openAccounts").onclick(); refreshStorage(); } };
    list.appendChild(row);
  }
  $("accTotal").textContent = accs.length ? `${accs.length} tài khoản · tổng còn trống ${human(free)} / ${human(all)}` : "Chưa có tài khoản nào.";
  show($("accModal"));
};
$("accClose").onclick = () => hide($("accModal"));
$("accModal").onclick = (e) => { if (e.target === $("accModal")) hide($("accModal")); };
$("addAccount").onclick = async () => {
  try { await dc.connectAccount(); $("openAccounts").onclick(); refreshStorage(); render(); }
  catch (e) { toast({ type: "error", message: "Ket noi that bai: " + (e.message || e) }); }
};

// ===== Tien trinh =====
const rows = new Map();
function ensureRow(key, name, cancelFn) {
  show($("progressPanel"));
  let r = rows.get(key);
  if (!r) {
    r = document.createElement("div");
    r.className = "pp-row";
    r.innerHTML = `<span class="ic">${iconFor(name)}</span><div class="info"><div class="t">${escapeHtml(name)}</div><div class="pbar"><div></div></div><div class="pct">Đang chuẩn bị…</div></div>` +
      (cancelFn ? `<span class="cancel" title="Hủy">✕</span>` : `<span class="done hidden">✔</span>`);
    $("ppList").appendChild(r);
    if (cancelFn) r.querySelector(".cancel").onclick = cancelFn;
    rows.set(key, r);
  }
  return r;
}
function setRowProgress(el, done, total) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  el.querySelector(".pbar > div").style.width = pct + "%";
  el.querySelector(".pct").textContent = `${human(done)} / ${human(total)}`;
}
function setRowDone(el, label) {
  const c = el.querySelector(".cancel"); if (c) c.remove();
  el.querySelector(".pbar").classList.add("hidden");
  el.querySelector(".pct").textContent = label || "Hoàn tất";
  let d = el.querySelector(".done"); if (!d) { d = document.createElement("span"); d.className = "done"; d.textContent = "✔"; el.appendChild(d); }
  d.classList.remove("hidden");
}
function setRowCanceled(el) {
  const c = el.querySelector(".cancel"); if (c) c.remove();
  el.querySelector(".pbar").classList.add("hidden");
  el.querySelector(".pct").textContent = "Đã hủy";
}
dc.onProgress(({ kind, name, uploadId, done, total }) => {
  if (kind === "upload") {
    setRowProgress(ensureRow(uploadId, name, () => dc.cancelUpload(uploadId)), done, total);
  } else {
    $("ppTitle").textContent = "Đang tải về";
    const el = ensureRow("dl:" + name, name, null);
    setRowProgress(el, done, total);
    if (done >= total) setRowDone(el);
  }
});
$("ppClose").onclick = () => { hide($("progressPanel")); $("ppList").innerHTML = ""; rows.clear(); };

dc.onToast((t) => toast(t));
function toast({ type, message }) {
  const el = document.createElement("div");
  el.className = "toast " + (type || "ok");
  el.textContent = message;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

route();

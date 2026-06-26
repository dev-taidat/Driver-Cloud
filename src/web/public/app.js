const $ = (id) => document.getElementById(id);
let currentDir = "/", searchQuery = "", view = "drive";

const api = {
  async get(u) { const r = await fetch(u); if (r.status === 401) location.reload(); return r.json(); },
  async post(u, b) { const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }); return r.json(); },
};
function human(b) { const u = ["B","KB","MB","GB","TB","PB"]; let i=0,n=b; while(n>=1024&&i<u.length-1){n/=1024;i++;} return `${n.toFixed(n<10&&i>0?1:0)} ${u[i]}`; }
function escapeHtml(s){return String(s).replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function show(e){e.classList.remove("hidden");} function hide(e){e.classList.add("hidden");}
function ext(n){return (n.split(".").pop()||"").toLowerCase();}
const IMG=["png","jpg","jpeg","gif","webp","bmp","heic"], VID=["mp4","webm","ogg","ogv","mov","m4v"];
function iconFor(n){const e=ext(n);
  if(IMG.includes(e))return"🖼️"; if(["mp4","mkv","avi","mov","webm","flv","m4v"].includes(e))return"🎬";
  if(["mp3","wav","flac","aac","ogg"].includes(e))return"🎵"; if(["zip","rar","7z","tar","gz"].includes(e))return"🗜️";
  if(e==="pdf")return"📕"; if(["doc","docx","txt","rtf"].includes(e))return"📄"; if(["xls","xlsx","csv"].includes(e))return"📊";
  return"📦";}

// ===== Render =====
async function render() {
  if (view === "trash") return renderTrash();
  if (searchQuery) return renderSearch();
  const { folders, files } = await api.get(`/api/list?dir=${encodeURIComponent(currentDir)}`);
  renderCrumbs();
  $("folders").innerHTML = ""; $("files").innerHTML = "";
  $("foldersSection").classList.toggle("hidden", folders.length === 0);
  $("filesSection").classList.toggle("hidden", files.length === 0);
  $("emptyHint").querySelector("p").innerHTML = 'Thư mục trống. Kéo-thả tệp vào đây hoặc bấm <b>＋ Mới</b>.';
  $("emptyHint").classList.toggle("hidden", folders.length + files.length > 0);
  folders.forEach((p) => $("folders").appendChild(folderCard(p)));
  files.forEach((f) => $("files").appendChild(fileCard(f)));
}
async function renderSearch() {
  const all = await api.get(`/api/list?dir=/`); // search toan bo: gom tu moi noi
  // de don gian: tim trong thu muc hien tai + de quy qua endpoint list la phuc tap -> dung trash+walk khong co; tam tim trong dir hien tai
  const q = searchQuery.toLowerCase();
  const files = (all.files || []).filter((f) => f.name.toLowerCase().includes(q));
  $("crumbs").innerHTML = `<span class="crumb last">Kết quả "${escapeHtml(searchQuery)}"</span>`;
  $("foldersSection").classList.add("hidden"); $("filesSection").classList.remove("hidden");
  $("emptyHint").classList.toggle("hidden", files.length > 0);
  $("files").innerHTML = ""; files.forEach((f) => $("files").appendChild(fileCard(f)));
}
async function renderTrash() {
  const files = await api.get("/api/trash");
  const box = $("crumbs"); box.innerHTML = '<span class="crumb last">Thùng rác</span>';
  if (files.length) {
    const b = document.createElement("button"); b.className = "btn-primary"; b.style.cssText = "margin-left:16px;font-size:13px;padding:6px 14px";
    b.textContent = "Dọn sạch thùng rác";
    b.onclick = async () => { if (confirm("Xóa vĩnh viễn TẤT CẢ?")) { await api.post("/api/emptyTrash"); render(); refreshStorage(); } };
    box.appendChild(b);
  }
  $("foldersSection").classList.add("hidden"); $("filesSection").classList.remove("hidden");
  $("emptyHint").classList.toggle("hidden", files.length > 0);
  if (!files.length) $("emptyHint").querySelector("p").innerHTML = "Thùng rác trống.";
  $("files").innerHTML = ""; files.forEach((f) => $("files").appendChild(trashCard(f)));
}
function renderCrumbs() {
  const box = $("crumbs"); box.innerHTML = "";
  const parts = currentDir === "/" ? [] : currentDir.split("/").filter(Boolean);
  const root = document.createElement("span"); root.className = "crumb" + (parts.length ? "" : " last"); root.textContent = "Drive của tôi"; root.onclick = () => navTo("/"); box.appendChild(root);
  let acc = "";
  parts.forEach((p, i) => { acc += "/" + p; const s = document.createElement("span"); s.className = "crumb-sep"; s.textContent = "›"; box.appendChild(s);
    const c = document.createElement("span"); c.className = "crumb" + (i === parts.length-1 ? " last" : ""); c.textContent = p; const t = acc; if (i !== parts.length-1) c.onclick = () => navTo(t); box.appendChild(c); });
}
function navTo(d){ view="drive"; setNav(); currentDir=d; render(); }
function setNav(){ $("navMyDrive").classList.toggle("active",view==="drive"); $("navTrash").classList.toggle("active",view==="trash"); }

function folderCard(p) {
  const name = p.slice(p.lastIndexOf("/") + 1);
  const el = document.createElement("div"); el.className = "card";
  el.innerHTML = `<span class="ic">📁</span><div class="nm"><div class="t">${escapeHtml(name)}</div></div><span class="more">⋮</span>`;
  el.ondblclick = () => navTo(p);
  const menu = (e) => { e.preventDefault(); e.stopPropagation(); showCtx(e, [
    { icon:"📂", label:"Mở", fn:()=>navTo(p) },
    { icon:"✏️", label:"Đổi tên", fn:async()=>{const n=prompt("Tên mới:",name); if(n&&n!==name){await api.post("/api/folder/rename",{dir:p,newName:n});render();}} },
    { icon:"🗑️", label:"Xóa (cả nội dung)", danger:true, fn:async()=>{if(confirm(`Xóa thư mục "${name}"?`)){await api.post("/api/removeFolder",{dir:p});render();refreshStorage();}} },
  ]); };
  el.querySelector(".more").onclick = menu; el.oncontextmenu = menu;
  return el;
}
function fileCard(f) {
  const el = document.createElement("div"); el.className = "card";
  const acc = f.account ? ` · ${escapeHtml(f.account.split("@")[0])}` : "";
  const ic = f.thumb ? `<img class="thumb" src="${f.thumb}">` : `<span class="ic">${iconFor(f.name)}</span>`;
  el.innerHTML = `${ic}<div class="nm"><div class="t">${escapeHtml(f.name)}</div><div class="s">${human(f.size)}${acc}</div></div><span class="more">⋮</span>`;
  el.title = f.account ? `Tài khoản: ${f.account}` : "";
  el.ondblclick = () => openPreview(f);
  const menu = (e) => { e.preventDefault(); e.stopPropagation(); showCtx(e, [
    { icon:"👁️", label:"Mở / Xem", fn:()=>openPreview(f) },
    { icon:"⬇️", label:"Tải về", fn:()=>downloadFile(f.id) },
    { icon:"✏️", label:"Đổi tên", fn:async()=>{const n=prompt("Tên mới:",f.name); if(n&&n!==f.name){await api.post("/api/rename",{id:f.id,newName:n});render();}} },
    { icon:"🗑️", label:"Xóa", danger:true, fn:async()=>{await api.post("/api/remove",{id:f.id});toast("Đã chuyển vào thùng rác");render();refreshStorage();} },
  ]); };
  el.querySelector(".more").onclick = menu; el.oncontextmenu = menu;
  return el;
}
function trashCard(f) {
  const el = document.createElement("div"); el.className = "card";
  el.innerHTML = `<span class="ic">${iconFor(f.name)}</span><div class="nm"><div class="t">${escapeHtml(f.name)}</div><div class="s">${human(f.size)}</div></div><span class="more">⋮</span>`;
  const menu = (e) => { e.preventDefault(); e.stopPropagation(); showCtx(e, [
    { icon:"♻️", label:"Khôi phục", fn:async()=>{await api.post("/api/restore",{id:f.id});render();refreshStorage();} },
    { icon:"🗑️", label:"Xóa vĩnh viễn", danger:true, fn:async()=>{if(confirm(`Xóa vĩnh viễn "${f.name}"?`)){await api.post("/api/deleteForever",{id:f.id});render();refreshStorage();}} },
  ]); };
  el.querySelector(".more").onclick = menu; el.oncontextmenu = menu;
  return el;
}

// ===== Context menu =====
function showCtx(e, items) {
  const m = $("ctxMenu"); m.innerHTML = "";
  items.forEach((it) => { const d = document.createElement("div"); d.className = "it" + (it.danger ? " danger" : ""); d.innerHTML = `<span>${it.icon}</span> ${it.label}`; d.onclick = () => { hide(m); it.fn(); }; m.appendChild(d); });
  m.style.left = Math.min(e.clientX, innerWidth - 200) + "px"; m.style.top = Math.min(e.clientY, innerHeight - 160) + "px"; show(m);
}
document.addEventListener("click", (e) => { if (!$("ctxMenu").contains(e.target)) hide($("ctxMenu")); hide($("newMenu")); });

// ===== Preview =====
let viewerFile = null;
function openPreview(f) {
  const e = ext(f.name);
  if (!IMG.includes(e) && !VID.includes(e)) return downloadFile(f.id); // loai khac -> tai ve
  viewerFile = f; $("viewerTitle").textContent = f.name;
  const src = `/api/preview/${f.id}`;
  $("viewerBody").innerHTML = IMG.includes(e) ? `<img src="${src}">` : `<video src="${src}" controls autoplay></video>`;
  show($("viewer"));
}
function closeViewer(){ hide($("viewer")); $("viewerBody").innerHTML=""; viewerFile=null; }
$("viewerClose").onclick = closeViewer;
$("viewer").onclick = (e) => { if (e.target === $("viewer")) closeViewer(); };
$("viewerDownload").onclick = () => viewerFile && downloadFile(viewerFile.id);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("viewer").classList.contains("hidden")) closeViewer(); });
function downloadFile(id){ window.location = `/api/download/${id}`; }

// ===== New / Upload =====
$("newBtn").onclick = (e) => { e.stopPropagation(); $("newMenu").classList.toggle("hidden"); };
$("newMenu").onclick = async (e) => {
  const act = e.target.dataset.act;
  if (act === "folder") { const n = prompt("Tên thư mục:"); if (n) { await api.post("/api/folder", { dir: currentDir, name: n }); render(); } }
  else if (act === "upload") $("fileInput").click();
};
$("fileInput").onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ""; };

async function uploadFiles(files) {
  for (const file of files) await uploadOne(file);
  render(); refreshStorage();
}
function uploadOne(file) {
  return new Promise((resolve) => {
    show($("progressPanel")); $("ppTitle").textContent = "Đang tải lên";
    const xhr = new XMLHttpRequest();
    const row = progRow("upload:" + file.name + Math.random(), file.name, () => xhr.abort());
    xhr.open("POST", `/api/upload?dir=${encodeURIComponent(currentDir)}`);
    xhr.upload.onprogress = (e) => setProg(row, e.loaded, e.total);
    xhr.onload = () => { setProg(row, 1, 1, true); resolve(); };
    xhr.onabort = () => { const c = row.querySelector(".cancel"); if (c) c.remove(); row.querySelector(".pct").textContent = "Đã hủy"; resolve(); };
    xhr.onerror = () => { toast("Lỗi tải lên " + file.name); resolve(); };
    const fd = new FormData(); fd.append("file", file); xhr.send(fd);
  });
}

// drag-drop
const content = $("content"); let dd = 0;
content.addEventListener("dragenter", (e) => { e.preventDefault(); if (dd++ === 0) show($("dropOverlay")); });
content.addEventListener("dragover", (e) => e.preventDefault());
content.addEventListener("dragleave", (e) => { e.preventDefault(); if (--dd <= 0){dd=0; hide($("dropOverlay"));} });
content.addEventListener("drop", (e) => { e.preventDefault(); dd=0; hide($("dropOverlay")); if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]); });

// ===== Progress UI =====
const progRows = new Map();
function progRow(key, name, cancelFn) {
  let r = progRows.get(key);
  if (!r) {
    r = document.createElement("div"); r.className = "pp-row";
    r.innerHTML = `<span class="ic">${iconFor(name)}</span><div class="info"><div class="t">${escapeHtml(name)}</div><div class="pbar"><div></div></div><div class="pct">Đang chuẩn bị…</div></div>` +
      (cancelFn ? `<span class="cancel" title="Hủy">✕</span>` : `<span class="done hidden">✔</span>`);
    $("ppList").appendChild(r); progRows.set(key, r);
    if (cancelFn) r.querySelector(".cancel").onclick = cancelFn;
  }
  return r;
}
function setProg(r, done, total, fin) {
  const pct = total > 0 ? (done/total)*100 : 100;
  r.querySelector(".pbar>div").style.width = pct + "%";
  r.querySelector(".pct").textContent = fin ? "Hoàn tất" : `${human(done)} / ${human(total)}`;
  if (fin) {
    const c = r.querySelector(".cancel"); if (c) c.remove();
    r.querySelector(".pbar").classList.add("hidden");
    let d = r.querySelector(".done"); if (!d) { d = document.createElement("span"); d.className = "done"; d.textContent = "✔"; r.appendChild(d); }
    d.classList.remove("hidden");
  }
}
$("ppClose").onclick = () => { hide($("progressPanel")); $("ppList").innerHTML = ""; progRows.clear(); };

// ===== Search =====
$("search").addEventListener("input", (e) => { searchQuery = e.target.value.trim(); $("searchClear").classList.toggle("hidden", !searchQuery); render(); });
$("searchClear").onclick = () => { $("search").value = ""; searchQuery = ""; hide($("searchClear")); render(); };

// ===== Accounts & storage =====
async function refreshStorage() {
  const accs = await api.get("/api/accounts");
  let used = 0, all = 0;
  accs.forEach((a) => { used += a.usedBytes; all += a.totalBytes; });
  $("usedBar").style.width = (all > 0 ? (used/all)*100 : 0) + "%";
  $("storageText").textContent = `${human(used)} / ${human(all)} đã dùng`;
  return accs;
}
let oauthStatus = { hasClient: false, redirectUri: "" };
async function openAccounts() {
  const accs = await refreshStorage();
  const list = $("accList"); list.innerHTML = ""; let free = 0, all = 0;
  accs.forEach((a) => { free += a.freeBytes; all += a.totalBytes;
    const pct = a.totalBytes > 0 ? (a.usedBytes/a.totalBytes)*100 : 0;
    const row = document.createElement("div"); row.className = "acc-row";
    row.innerHTML = `<div class="em">${a.email}</div><div class="mini"><div style="width:${pct}%"></div></div><div class="r"><span class="muted small">còn ${human(a.freeBytes)} / ${human(a.totalBytes)}</span><button class="rm">Gỡ</button></div>`;
    row.querySelector(".rm").onclick = async () => { if (confirm(`Gỡ ${a.email}?`)) { await api.post("/api/accounts/disconnect", { id: a.id }); openAccounts(); refreshStorage(); } };
    list.appendChild(row); });
  $("accTotal").textContent = accs.length ? `${accs.length} tài khoản · tổng còn trống ${human(free)} / ${human(all)}` : "Chưa có tài khoản nào kết nối.";

  oauthStatus = await api.get("/api/oauth/status");
  $("oauthSetup").classList.toggle("hidden", oauthStatus.hasClient);
  $("addAccount").classList.toggle("hidden", !oauthStatus.hasClient);
  $("guide").innerHTML = guideHtml(oauthStatus.redirectUri);
  show($("accModal"));
}
$("openAccounts").onclick = openAccounts;
$("accClose").onclick = () => hide($("accModal"));
$("accModal").onclick = (e) => { if (e.target === $("accModal")) hide($("accModal")); };
$("addAccount").onclick = () => { location.href = "/oauth/start"; };
$("guideToggle").onclick = (e) => { e.preventDefault(); $("guide").classList.toggle("hidden"); };
$("saveClient").onclick = async () => {
  const clientId = $("cid").value.trim(), clientSecret = $("csec").value.trim();
  if (!clientId || !clientSecret) return toast("Nhập đủ Client ID và Secret");
  await api.post("/api/oauth/client", { clientId, clientSecret });
  openAccounts();
  toast("Đã lưu OAuth. Giờ bấm '+ Thêm tài khoản Google Drive'.");
};

function guideHtml(redirect) {
  return `<ol class="guide-list">
    <li>Vào <b>console.cloud.google.com</b> → tạo project (miễn phí, không cần thẻ).</li>
    <li>APIs &amp; Services → <b>Library</b> → bật <b>Google Drive API</b>.</li>
    <li>OAuth consent screen → <b>External</b> → điền tên + email → <b>Publish app</b> (để token vĩnh viễn).</li>
    <li>Credentials → Create credentials → <b>OAuth client ID</b> → loại <b>Web application</b>.</li>
    <li>Mục <b>Authorized redirect URIs</b> → thêm đúng dòng này:<br>
      <code class="redirect">${redirect}</code></li>
    <li>Tạo xong → copy <b>Client ID</b> &amp; <b>Client Secret</b> dán vào ô dưới.</li>
  </ol>`;
}

$("logoutBtn").onclick = async () => { await fetch("/logout", { method: "POST" }); location.reload(); };
async function loadMe() { try { const m = await api.get("/api/me"); $("meName").textContent = m.username ? "👤 " + m.username : ""; } catch {} }
$("navMyDrive").onclick = () => { view = "drive"; searchQuery = ""; $("search").value = ""; hide($("searchClear")); setNav(); render(); };
$("navTrash").onclick = () => { view = "trash"; setNav(); render(); };

function toast(msg) { const el = document.createElement("div"); el.className = "toast ok"; el.textContent = msg; $("toasts").appendChild(el); setTimeout(() => el.remove(), 4000); }

render(); refreshStorage(); loadMe();

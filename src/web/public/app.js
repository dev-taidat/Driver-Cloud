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

// ===== Hop thoai dep (thay prompt/confirm cua trinh duyet) =====
function dlg({ title, input = false, value = "", okText = "OK", danger = false }) {
  return new Promise((resolve) => {
    $("dlgTitle").textContent = title;
    const inp = $("dlgInput");
    inp.classList.toggle("hidden", !input);
    inp.value = value;
    const ok = $("dlgOk"), cancel = $("dlgCancel");
    ok.textContent = okText; ok.classList.toggle("danger-btn", danger);
    show($("dialog"));
    if (input) setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const done = (val) => { hide($("dialog")); ok.onclick = cancel.onclick = inp.onkeydown = null; resolve(val); };
    ok.onclick = () => done(input ? inp.value : true);
    cancel.onclick = () => done(input ? null : false);
    inp.onkeydown = (e) => { if (e.key === "Enter") ok.onclick(); if (e.key === "Escape") cancel.onclick(); };
  });
}
const askPrompt = (title, value = "") => dlg({ title, input: true, value, okText: "OK" });
const askConfirm = (title, danger = true) => dlg({ title, danger, okText: "Đồng ý" });
$("dialog").addEventListener("click", (e) => { if (e.target === $("dialog")) $("dlgCancel").onclick && $("dlgCancel").onclick(); });
const IMG=["png","jpg","jpeg","gif","webp","bmp","heic"], VID=["mp4","webm","ogg","ogv","mov","m4v"];
function iconFor(n){const e=ext(n);
  if(IMG.includes(e))return"🖼️"; if(["mp4","mkv","avi","mov","webm","flv","m4v"].includes(e))return"🎬";
  if(["mp3","wav","flac","aac","ogg"].includes(e))return"🎵"; if(["zip","rar","7z","tar","gz"].includes(e))return"🗜️";
  if(e==="pdf")return"📕"; if(["doc","docx","txt","rtf"].includes(e))return"📄"; if(["xls","xlsx","csv"].includes(e))return"📊";
  return"📦";}

// ===== Render =====
async function render() {
  const fv = document.getElementById("familyView");
  if (fv) fv.classList.add("hidden");
  if (view === "family") return renderFamily();
  if (view === "trash") return renderTrash();
  if (view === "sharedList") return renderSharedList();
  if (view === "shared") return renderShared();
  if (view === "granted") return renderGranted();
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
  const files = await api.get(`/api/search?q=${encodeURIComponent(searchQuery)}`); // tim TOAN BO file
  $("crumbs").innerHTML = `<span class="crumb last">Kết quả "${escapeHtml(searchQuery)}" (${files.length})</span>`;
  $("foldersSection").classList.add("hidden"); $("filesSection").classList.remove("hidden");
  $("emptyHint").classList.toggle("hidden", files.length > 0);
  if (!files.length) $("emptyHint").querySelector("p").innerHTML = "Không tìm thấy tệp nào.";
  $("files").innerHTML = ""; files.forEach((f) => $("files").appendChild(fileCard(f)));
}
async function renderTrash() {
  const files = await api.get("/api/trash");
  const box = $("crumbs"); box.innerHTML = '<span class="crumb last">Thùng rác</span>';
  if (files.length) {
    const b = document.createElement("button"); b.className = "btn-primary"; b.style.cssText = "margin-left:16px;font-size:13px;padding:6px 14px";
    b.textContent = "Dọn sạch thùng rác";
    b.onclick = async () => { if (await askConfirm("Xóa vĩnh viễn TẤT CẢ?")) { await api.post("/api/emptyTrash"); render(); refreshStorage(); } };
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
function setNav(){
  $("navMyDrive").classList.toggle("active", view==="drive");
  $("navShared").classList.toggle("active", view==="sharedList" || view==="shared");
  $("navFamily").classList.toggle("active", view==="family");
  $("navTrash").classList.toggle("active", view==="trash");
}

function folderCard(p) {
  const name = p.slice(p.lastIndexOf("/") + 1);
  const el = document.createElement("div"); el.className = "card";
  el.innerHTML = `<span class="ic">📁</span><div class="nm"><div class="t">${escapeHtml(name)}</div></div><span class="more">⋮</span>`;
  el.ondblclick = () => navTo(p);
  const menu = (e) => { e.preventDefault(); e.stopPropagation(); showCtx(e, [
    { icon:"📂", label:"Mở", fn:()=>navTo(p) },
    { icon:"👥", label:"Chia sẻ", fn:()=>openShareModal(p, name) },
    { icon:"✏️", label:"Đổi tên", fn:async()=>{const n=await askPrompt("Tên mới:",name); if(n&&n!==name){await api.post("/api/folder/rename",{dir:p,newName:n});render();}} },
    { icon:"🗑️", label:"Xóa (cả nội dung)", danger:true, fn:async()=>{if(await askConfirm(`Xóa thư mục "${name}"?`)){await api.post("/api/removeFolder",{dir:p});render();refreshStorage();}} },
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
    // Chi hien trong app desktop: tai ve -> mo editor -> luu la tu dong bo len cloud
    (window.dcDesktop && window.dcDesktop.isDesktop) ? { icon:"🖊️", label:"Mở để sửa (đồng bộ)", fn:async()=>{const r=await window.dcDesktop.edit(f.id,f.name,currentDir); if(r&&r.ok)toast("Đang mở để sửa — lưu là tự đồng bộ lên cloud"); else toast((r&&r.error)||"Không mở được");} } : null,
    // Online/offline tung file trong o (kieu Google Drive)
    (window.dcDesktop && window.dcDesktop.isDesktop) ? { icon:"📥", label:"Đưa offline (tải về máy)", fn:async()=>{const r=await window.dcDesktop.makeOffline(f.path); toast(r&&r.ok?"Đang tải về máy (offline)…":"Lỗi: "+((r&&r.error)||""));} } : null,
    (window.dcDesktop && window.dcDesktop.isDesktop) ? { icon:"☁️", label:"Đưa online (giải phóng ổ)", fn:async()=>{const r=await window.dcDesktop.makeOnline(f.path); toast(r&&r.ok?"Đã giải phóng ổ (online)":"Lỗi: "+((r&&r.error)||""));} } : null,
    { icon:"📂", label:"Chuyển tới…", fn:()=>openMove(f) },
    { icon:"✏️", label:"Đổi tên", fn:async()=>{const n=await askPrompt("Tên mới:",f.name); if(n&&n!==f.name){await api.post("/api/rename",{id:f.id,newName:n});render();}} },
    { icon:"🗑️", label:"Xóa", danger:true, fn:async()=>{await api.post("/api/remove",{id:f.id});toast("Đã chuyển vào thùng rác");render();refreshStorage();} },
  ].filter(Boolean)); };
  el.querySelector(".more").onclick = menu; el.oncontextmenu = menu;
  return el;
}
function trashCard(f) {
  const el = document.createElement("div"); el.className = "card";
  el.innerHTML = `<span class="ic">${iconFor(f.name)}</span><div class="nm"><div class="t">${escapeHtml(f.name)}</div><div class="s">${human(f.size)}</div></div><span class="more">⋮</span>`;
  const menu = (e) => { e.preventDefault(); e.stopPropagation(); showCtx(e, [
    { icon:"♻️", label:"Khôi phục", fn:async()=>{await api.post("/api/restore",{id:f.id});render();refreshStorage();} },
    { icon:"🗑️", label:"Xóa vĩnh viễn", danger:true, fn:async()=>{if(await askConfirm(`Xóa vĩnh viễn "${f.name}"?`)){await api.post("/api/deleteForever",{id:f.id});render();refreshStorage();}} },
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
let viewerDl = null;
function openPreview(f, previewUrl, downloadUrl) {
  const e = ext(f.name);
  const dl = downloadUrl || `/api/download/${f.id}`;
  if (!IMG.includes(e) && !VID.includes(e)) { window.location = dl; return; } // loai khac -> tai ve
  viewerDl = dl; $("viewerTitle").textContent = f.name;
  const src = previewUrl || `/api/preview/${f.id}`;
  $("viewerBody").innerHTML = IMG.includes(e) ? `<img src="${src}">` : `<video src="${src}" controls autoplay></video>`;
  show($("viewer"));
}
function closeViewer(){ hide($("viewer")); $("viewerBody").innerHTML=""; viewerDl=null; }
$("viewerClose").onclick = closeViewer;
$("viewer").onclick = (e) => { if (e.target === $("viewer")) closeViewer(); };
$("viewerDownload").onclick = () => viewerDl && (window.location = viewerDl);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("viewer").classList.contains("hidden")) closeViewer(); });
function downloadFile(id){ window.location = `/api/download/${id}`; }

// ===== New / Upload =====
$("newBtn").onclick = (e) => { e.stopPropagation(); $("newMenu").classList.toggle("hidden"); };
function canWriteHere() { return view === "drive" || view === "granted" || (view === "shared" && currentShare && currentShare.permission === "edit"); }
function uploadEndpoint() {
  if (view === "granted") return `/api/granted/upload?grantId=${encodeURIComponent(currentGrant.grantId)}`;
  if (view === "shared") return `/api/shared/upload?shareId=${encodeURIComponent(currentShare.shareId)}&dir=${encodeURIComponent(currentShare.dir)}`;
  return `/api/upload?dir=${encodeURIComponent(currentDir)}`;
}
$("newMenu").onclick = async (e) => {
  const act = e.target.dataset.act;
  if (!canWriteHere()) { hide($("newMenu")); return toast("Không thể tạo/tải lên ở mục này."); }
  if (act === "folder") {
    const n = await askPrompt("Tên thư mục:");
    if (n) {
      if (view === "shared") await api.post("/api/shared/folder", { shareId: currentShare.shareId, dir: currentShare.dir, name: n });
      else await api.post("/api/folder", { dir: currentDir, name: n });
      render();
    }
  } else if (act === "upload") $("fileInput").click();
};
$("fileInput").onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ""; };

async function uploadFiles(files) {
  if (!canWriteHere()) return toast("Không thể tải lên ở mục này.");
  for (const file of files) await uploadOne(file);
  render(); refreshStorage();
}
function uploadOne(file) {
  // App desktop + dang o "Drive của tôi" -> upload THANG may<->Drive (nhanh ~10x)
  if (window.dcDesktop && window.dcDesktop.isDesktop && view === "drive") {
    const p = window.dcDesktop.pathForFile(file);
    if (p) return (async () => {
      show($("progressPanel")); $("ppTitle").textContent = "Đang tải lên (trực tiếp)";
      const row = progRow("upd:" + file.name + Math.random(), file.name, null);
      row.querySelector(".pct").textContent = "Đang tải thẳng lên Drive…";
      const r = await window.dcDesktop.upload(p, currentDir);
      if (r && r.ok) setProg(row, 1, 1, true);
      else { row.querySelector(".pct").textContent = "Lỗi: " + ((r && r.error) || ""); toast("Lỗi tải lên " + file.name); }
      render(); refreshStorage();
    })();
  }
  return new Promise((resolve) => {
    show($("progressPanel")); $("ppTitle").textContent = "Đang tải lên";
    const xhr = new XMLHttpRequest();
    const row = progRow("upload:" + file.name + Math.random(), file.name, () => xhr.abort());
    xhr.open("POST", uploadEndpoint());
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
    row.querySelector(".rm").onclick = async () => { if (await askConfirm(`Gỡ ${a.email}?`)) { await api.post("/api/accounts/disconnect", { id: a.id }); openAccounts(); refreshStorage(); } };
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

$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const bundle = JSON.parse(await file.text());
    const r = await api.post("/api/import", bundle);
    if (r.error) { toast("Lỗi: " + r.error); }
    else { toast("Đã nhập dữ liệu! Đang tải lại..."); setTimeout(() => location.reload(), 800); }
  } catch (err) { toast("File không hợp lệ."); }
  e.target.value = "";
};
$("logoutBtn").onclick = async () => { await fetch("/logout", { method: "POST" }); location.reload(); };
async function loadMe() {
  try {
    const m = await api.get("/api/me");
    $("meName").textContent = m.username ? "👤 " + m.username : "";
    if ($("usernameEdit")) $("usernameEdit").value = m.username || "";
    // Tai khoan cu (chua co email) -> bat hoan tat ho so
    if (!m.email) {
      $("pfUsername").value = (m.username || "").includes("@") ? "" : (m.username || "");
      if ((m.username || "").includes("@")) $("pfEmail").value = m.username;
      show($("profileModal"));
    } else { hide($("profileModal")); }
  } catch {}
}
$("pfSave").onclick = async () => {
  $("pfErr").textContent = "";
  const r = await api.post("/api/account/profile", { username: $("pfUsername").value, email: $("pfEmail").value });
  if (r.error) return ($("pfErr").textContent = r.error);
  hide($("profileModal")); toast("Đã cập nhật hồ sơ"); loadMe(); render();
};
// Doi username
if ($("saveUsername")) $("saveUsername").onclick = async () => {
  const r = await api.post("/api/account/username", { username: $("usernameEdit").value });
  if (r.error) return toast(r.error);
  toast("Đã đổi tên hiển thị"); loadMe();
};
if ($("savePw")) $("savePw").onclick = async () => {
  const r = await api.post("/api/account/password", { oldPw: $("oldPw").value, newPw: $("newPw").value });
  if (r.error) return toast(r.error);
  $("oldPw").value = ""; $("newPw").value = ""; toast("Đã đổi mật khẩu");
};

// ===== Di chuyen file giua thu muc =====
let moveFileId = null;
async function openMove(f) {
  moveFileId = f.id;
  $("moveFileName").textContent = `Chuyển "${f.name}" tới:`;
  const folders = await api.get("/api/folders");
  $("moveSelect").innerHTML = folders.map((p) => `<option value="${p}">${p === "/" ? "/ (gốc)" : escapeHtml(p)}</option>`).join("");
  show($("moveModal"));
}
$("moveClose").onclick = () => hide($("moveModal"));
$("moveModal").onclick = (e) => { if (e.target === $("moveModal")) hide($("moveModal")); };
$("moveBtn").onclick = async () => { await api.post("/api/move", { id: moveFileId, dir: $("moveSelect").value }); hide($("moveModal")); render(); toast("Đã chuyển"); };

// ===== Thong bao (chuong) =====
async function loadNotifs() {
  try {
    const n = await api.get("/api/notifications");
    const b = $("bellBadge");
    if (n.unread > 0) { b.textContent = n.unread; b.classList.remove("hidden"); } else b.classList.add("hidden");
    const list = $("notifList");
    list.innerHTML = n.items.length ? "" : '<div class="notif-empty">Chưa có thông báo.</div>';
    n.items.forEach((it) => {
      const el = document.createElement("div");
      el.className = "notif-item" + (it.read ? "" : " unread");
      el.innerHTML = `${escapeHtml(it.message)}<span class="time">${new Date(it.createdAt).toLocaleString("vi-VN")}</span>`;
      list.appendChild(el);
    });
  } catch {}
}
$("bellBtn").onclick = (e) => {
  e.stopPropagation();
  const p = $("notifPanel");
  p.classList.toggle("hidden");
  if (!p.classList.contains("hidden")) loadNotifs();
};
$("notifRead").onclick = async () => { await api.post("/api/notifications/read"); loadNotifs(); };
document.addEventListener("click", (e) => { if (!$("notifPanel").contains(e.target) && e.target !== $("bellBtn")) $("notifPanel").classList.add("hidden"); });

// ===== Family & Chia se (TAB trong noi dung chinh) =====
$("navFamily").onclick = () => { view = "family"; searchQuery = ""; $("search").value = ""; hide($("searchClear")); setNav(); render(); };
async function renderFamily() {
  $("crumbs").innerHTML = '<span class="crumb last">👨‍👩‍👧 Family & Chia sẻ</span>';
  $("foldersSection").classList.add("hidden");
  $("filesSection").classList.add("hidden");
  $("emptyHint").classList.add("hidden");
  $("familyView").classList.remove("hidden");
  // do danh sach muc co the chia se: toan bo kho + thu muc cap goc
  const root = await api.get("/api/list?dir=/");
  const sel = $("famScope"); sel.innerHTML = '<option value="/">Toàn bộ kho</option>';
  (root.folders || []).forEach((p) => { const o = document.createElement("option"); o.value = p; o.textContent = p; sel.appendChild(o); });
  $("famUser").value = ""; $("famErr").textContent = "";
  await loadFamList();
  await loadFarms();
}

// ===== Quan ly NHIEU farm =====
let curFarm = null;
async function loadFarms() {
  const list = await api.get("/api/farms");
  const sel = $("farmSelect");
  const has = list.length > 0;
  $("farmConfig").classList.toggle("hidden", !has);
  $("farmEmpty").classList.toggle("hidden", has);
  $("farmRename").style.display = has ? "" : "none";
  $("farmDelete").style.display = has ? "" : "none";
  if (!has) { sel.innerHTML = ""; curFarm = null; return; }
  // giu farm dang chon neu con
  if (!list.find((f) => f.id === curFarm)) curFarm = list[0].id;
  sel.innerHTML = list.map((f) => `<option value="${f.id}">${escapeHtml(f.name)} (${f.memberCount} tv · ${gb(f.totalAllocated).toFixed(0)} GB)</option>`).join("");
  sel.value = curFarm;
  await loadFarmMembers();
}
async function loadFarmMembers() {
  curFarm = $("farmSelect").value;
  const members = await api.get(`/api/farms/members?farmId=${encodeURIComponent(curFarm)}`);
  const totalGB = members.reduce((s, m) => s + m.quotaBytes, 0);
  $("famSummary").textContent = members.length ? `· ${members.length} thành viên · ${gb(totalGB).toFixed(0)} GB` : "";
  const box = $("grantList");
  box.innerHTML = members.length ? "" : '<div class="muted small">Farm này chưa có thành viên.</div>';
  members.forEach((g) => {
    const pct = g.quotaBytes > 0 ? Math.min(100, (g.usedBytes / g.quotaBytes) * 100) : 0;
    const row = document.createElement("div"); row.className = "acc-row";
    row.innerHTML = `
      <div class="r"><span><b>${escapeHtml(g.member)}</b></span><span class="muted small">${gb(g.usedBytes).toFixed(2)} / ${gb(g.quotaBytes).toFixed(0)} GB</span></div>
      <div class="mini"><div style="width:${pct}%"></div></div>
      <div style="display:flex;gap:6px;margin-top:7px">
        <input class="qedit fld" type="number" min="1" value="${Math.round(gb(g.quotaBytes))}" style="flex:1;margin:0;padding:6px 9px" />
        <button class="save btn-primary" style="padding:6px 12px">Lưu</button>
        <button class="rm" style="padding:6px 10px">Xóa</button>
      </div>`;
    row.querySelector(".save").onclick = async () => { await api.post("/api/family/grant/quota", { grantId: g.id, quotaGB: Number(row.querySelector(".qedit").value) }); loadFarms(); toast("Đã đổi hạn mức"); };
    row.querySelector(".rm").onclick = async () => { if (await askConfirm(`Xóa ${g.member} khỏi farm? (thu hồi dung lượng)`)) { await api.post("/api/family/grant/revoke", { grantId: g.id }); loadFarms(); } };
    box.appendChild(row);
  });
}
$("farmSelect").onchange = () => loadFarmMembers();
$("farmNew").onclick = async () => { const n = await askPrompt("Tên farm mới:"); if (n) { const r = await api.post("/api/farms", { name: n }); curFarm = r.id; loadFarms(); toast("Đã tạo farm"); } };
$("farmRename").onclick = async () => { if (!curFarm) return; const n = await askPrompt("Tên farm mới:"); if (n) { await api.post("/api/farms/rename", { id: curFarm, name: n }); loadFarms(); } };
$("farmDelete").onclick = async () => { if (!curFarm) return; if (await askConfirm("Xóa farm này? (thu hồi dung lượng của mọi thành viên trong farm)")) { await api.post("/api/farms/delete", { id: curFarm }); curFarm = null; loadFarms(); } };

// Goi y username khi go (cho cac o chia se/cap)
async function refreshUserOptions(q) {
  try {
    const users = await api.get("/api/users/search?q=" + encodeURIComponent(q || ""));
    $("userOptions").innerHTML = users.map((u) => `<option value="${escapeHtml(u)}"></option>`).join("");
  } catch {}
}
["shareUser", "famUser", "grantUser"].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener("input", () => refreshUserOptions(el.value));
  if (el) el.addEventListener("focus", () => refreshUserOptions(el.value));
});
$("grantBtn").onclick = async () => {
  if (!curFarm) return ($("grantErr").textContent = "Tạo hoặc chọn farm trước.");
  $("grantErr").textContent = "";
  const r = await api.post("/api/family/grant", { farmId: curFarm, memberUsername: $("grantUser").value, quotaGB: Number($("grantGB").value) });
  if (r.error) return ($("grantErr").textContent = r.error);
  $("grantUser").value = ""; $("grantGB").value = ""; loadFarms(); toast("Đã cấp dung lượng");
};
async function loadFamList() {
  const mine = await api.get("/api/shares/mine");
  const box = $("famList");
  box.innerHTML = mine.length ? "" : '<div class="muted small">Bạn chưa chia sẻ gì.</div>';
  mine.forEach((s) => {
    const row = document.createElement("div"); row.className = "acc-row";
    row.innerHTML = `<div class="r"><span><b>${escapeHtml(s.name)}</b> → ${escapeHtml(s.to)} · ${s.permission === "edit" ? "sửa" : "xem"}</span><button class="rm">Thu hồi</button></div>`;
    row.querySelector(".rm").onclick = async () => { await api.post("/api/share/revoke", { id: s.id }); loadFamList(); };
    box.appendChild(row);
  });
}
$("famShareBtn").onclick = async () => {
  $("famErr").textContent = "";
  const r = await api.post("/api/share", { path: $("famScope").value, toUsername: $("famUser").value, permission: $("famPerm").value });
  if (r.error) return ($("famErr").textContent = r.error);
  $("famUser").value = ""; loadFamList(); toast("Đã chia sẻ");
};
$("navMyDrive").onclick = () => { view = "drive"; searchQuery = ""; $("search").value = ""; hide($("searchClear")); setNav(); render(); };
$("navTrash").onclick = () => { view = "trash"; setNav(); render(); };
$("navShared").onclick = () => { view = "sharedList"; setNav(); render(); };

// ===== Chia se: modal tao chia se =====
let shareTargetPath = "/";
function openShareModal(p, name) {
  shareTargetPath = p;
  $("shareTarget").textContent = `Thư mục: ${name} (${p})`;
  $("shareUser").value = ""; $("shareErr").textContent = "";
  loadShareList();
  show($("shareModal"));
}
async function loadShareList() {
  const mine = await api.get("/api/shares/mine");
  const here = mine.filter((s) => s.path === shareTargetPath);
  const box = $("shareList"); box.innerHTML = here.length ? "" : '<div class="muted small">Chưa chia sẻ với ai.</div>';
  here.forEach((s) => {
    const row = document.createElement("div"); row.className = "acc-row";
    row.innerHTML = `<div class="r"><span><b>${escapeHtml(s.to)}</b> · ${s.permission === "edit" ? "sửa" : "xem"}</span><button class="rm">Thu hồi</button></div>`;
    row.querySelector(".rm").onclick = async () => { await api.post("/api/share/revoke", { id: s.id }); loadShareList(); };
    box.appendChild(row);
  });
}
$("shareClose").onclick = () => hide($("shareModal"));
$("shareModal").onclick = (e) => { if (e.target === $("shareModal")) hide($("shareModal")); };
$("shareBtn").onclick = async () => {
  $("shareErr").textContent = "";
  const r = await api.post("/api/share", { path: shareTargetPath, toUsername: $("shareUser").value, permission: $("sharePerm").value });
  if (r.error) return ($("shareErr").textContent = r.error);
  $("shareUser").value = ""; loadShareList();
  toast("Đã chia sẻ");
};

// ===== Chia se: duyet =====
let currentShare = null;
let currentGrant = null;
function gb(bytes) { return (bytes / 1024 ** 3); }
async function renderSharedList() {
  const [shares, granted] = await Promise.all([api.get("/api/shared-with-me"), api.get("/api/granted")]);
  $("crumbs").innerHTML = '<span class="crumb last">Được chia sẻ với tôi</span>';
  $("foldersSection").classList.remove("hidden"); $("filesSection").classList.add("hidden");
  const total = shares.length + granted.length;
  $("emptyHint").classList.toggle("hidden", total > 0);
  if (!total) $("emptyHint").querySelector("p").innerHTML = "Chưa có ai chia sẻ hay cấp dung lượng cho bạn.";
  const box = $("folders"); box.innerHTML = "";
  granted.forEach((g) => {
    const el = document.createElement("div"); el.className = "card";
    el.innerHTML = `<span class="ic">💾</span><div class="nm"><div class="t">${escapeHtml(g.farm || "Bộ nhớ")} · từ ${escapeHtml(g.owner)}</div><div class="s">${gb(g.usedBytes).toFixed(2)} / ${gb(g.quotaBytes).toFixed(0)} GB</div></div>`;
    el.onclick = () => { view = "granted"; currentGrant = { grantId: g.grantId, owner: g.owner, quotaBytes: g.quotaBytes }; setNav(); render(); };
    box.appendChild(el);
  });
  shares.forEach((s) => {
    const el = document.createElement("div"); el.className = "card";
    el.innerHTML = `<span class="ic">👥</span><div class="nm"><div class="t">${escapeHtml(s.name)}</div><div class="s">từ ${escapeHtml(s.owner)} · ${s.permission === "edit" ? "có thể sửa" : "chỉ xem"}</div></div>`;
    el.onclick = () => { view = "shared"; currentShare = { shareId: s.shareId, base: s.path, dir: s.path, permission: s.permission, owner: s.owner }; setNav(); render(); };
    box.appendChild(el);
  });
}

// ===== Member: dung kho duoc cap (grant) =====
async function renderGranted() {
  const r = await api.get(`/api/granted/list?grantId=${encodeURIComponent(currentGrant.grantId)}`);
  if (r.error) { toast(r.error); view = "sharedList"; setNav(); return render(); }
  currentGrant.quotaBytes = r.quotaBytes;
  const used = gb(r.usedBytes).toFixed(2), q = gb(r.quotaBytes).toFixed(0);
  const box = $("crumbs"); box.innerHTML = "";
  const back = document.createElement("span"); back.className = "crumb"; back.textContent = "Được chia sẻ với tôi"; back.onclick = () => { view = "sharedList"; setNav(); render(); }; box.appendChild(back);
  const sep = document.createElement("span"); sep.className = "crumb-sep"; sep.textContent = "›"; box.appendChild(sep);
  const cur = document.createElement("span"); cur.className = "crumb last"; cur.textContent = `Bộ nhớ từ ${currentGrant.owner} — ${used}/${q} GB`; box.appendChild(cur);
  $("foldersSection").classList.add("hidden");
  $("filesSection").classList.remove("hidden");
  $("emptyHint").classList.toggle("hidden", r.files.length > 0);
  if (!r.files.length) $("emptyHint").querySelector("p").innerHTML = `Kho riêng của bạn (${q} GB). Kéo-thả tệp để tải lên.`;
  $("files").innerHTML = "";
  r.files.forEach((f) => $("files").appendChild(grantedFileCard(f)));
}
function grantedFileCard(f) {
  const gid = currentGrant.grantId;
  const previewUrl = `/api/granted/preview/${gid}/${f.id}`, dlUrl = `/api/granted/download/${gid}/${f.id}`;
  const el = document.createElement("div"); el.className = "card";
  const ic = f.thumb ? `<img class="thumb" src="${f.thumb}">` : `<span class="ic">${iconFor(f.name)}</span>`;
  el.innerHTML = `${ic}<div class="nm"><div class="t">${escapeHtml(f.name)}</div><div class="s">${human(f.size)}</div></div><span class="more">⋮</span>`;
  el.ondblclick = () => openPreview(f, previewUrl, dlUrl);
  const menu = (e) => { e.preventDefault(); e.stopPropagation(); showCtx(e, [
    { icon: "👁️", label: "Mở / Xem", fn: () => openPreview(f, previewUrl, dlUrl) },
    { icon: "⬇️", label: "Tải về", fn: () => (window.location = dlUrl) },
    { icon: "🗑️", label: "Xóa", danger: true, fn: async () => { await api.post("/api/granted/remove", { grantId: gid, id: f.id }); render(); } },
  ]); };
  el.querySelector(".more").onclick = menu; el.oncontextmenu = menu;
  return el;
}
async function renderShared() {
  const r = await api.get(`/api/shared/list?shareId=${encodeURIComponent(currentShare.shareId)}&dir=${encodeURIComponent(currentShare.dir)}`);
  if (r.error) { toast(r.error); view = "sharedList"; setNav(); return render(); }
  currentShare.permission = r.permission;
  renderSharedCrumbs();
  $("folders").innerHTML = ""; $("files").innerHTML = "";
  $("foldersSection").classList.toggle("hidden", r.folders.length === 0);
  $("filesSection").classList.toggle("hidden", r.files.length === 0);
  $("emptyHint").classList.toggle("hidden", r.folders.length + r.files.length > 0);
  if (!r.folders.length && !r.files.length) $("emptyHint").querySelector("p").innerHTML = currentShare.permission === "edit" ? "Trống. Kéo-thả tệp để tải lên." : "Thư mục này trống.";
  r.folders.forEach((p) => $("folders").appendChild(sharedFolderCard(p)));
  r.files.forEach((f) => $("files").appendChild(sharedFileCard(f)));
}
function renderSharedCrumbs() {
  const box = $("crumbs"); box.innerHTML = "";
  const back = document.createElement("span"); back.className = "crumb"; back.textContent = "Được chia sẻ với tôi"; back.onclick = () => { view = "sharedList"; setNav(); render(); }; box.appendChild(back);
  const base = currentShare.base;
  const bname = base === "/" ? `Kho của ${currentShare.owner}` : base.slice(base.lastIndexOf("/") + 1);
  const sep = () => { const s = document.createElement("span"); s.className = "crumb-sep"; s.textContent = "›"; box.appendChild(s); };
  sep();
  const root = document.createElement("span"); root.className = "crumb" + (currentShare.dir === base ? " last" : ""); root.textContent = bname; root.onclick = () => { currentShare.dir = base; render(); }; box.appendChild(root);
  if (currentShare.dir !== base) {
    const rest = currentShare.dir.slice(base === "/" ? 1 : base.length).split("/").filter(Boolean);
    let acc = base === "/" ? "" : base;
    rest.forEach((p, i) => { acc += "/" + p; sep(); const c = document.createElement("span"); c.className = "crumb" + (i === rest.length - 1 ? " last" : ""); c.textContent = p; const t = acc; if (i !== rest.length - 1) c.onclick = () => { currentShare.dir = t; render(); }; box.appendChild(c); });
  }
}
function sharedFolderCard(p) {
  const name = p.slice(p.lastIndexOf("/") + 1);
  const el = document.createElement("div"); el.className = "card";
  el.innerHTML = `<span class="ic">📁</span><div class="nm"><div class="t">${escapeHtml(name)}</div></div>`;
  el.ondblclick = () => { currentShare.dir = p; render(); };
  el.onclick = () => { currentShare.dir = p; render(); };
  return el;
}
function sharedFileCard(f) {
  const sid = currentShare.shareId;
  const previewUrl = `/api/shared/preview/${sid}/${f.id}`, dlUrl = `/api/shared/download/${sid}/${f.id}`;
  const el = document.createElement("div"); el.className = "card";
  const ic = f.thumb ? `<img class="thumb" src="${f.thumb}">` : `<span class="ic">${iconFor(f.name)}</span>`;
  el.innerHTML = `${ic}<div class="nm"><div class="t">${escapeHtml(f.name)}</div><div class="s">${human(f.size)}</div></div><span class="more">⋮</span>`;
  el.ondblclick = () => openPreview(f, previewUrl, dlUrl);
  const items = [
    { icon: "👁️", label: "Mở / Xem", fn: () => openPreview(f, previewUrl, dlUrl) },
    { icon: "⬇️", label: "Tải về", fn: () => (window.location = dlUrl) },
  ];
  if (currentShare.permission === "edit") items.push({ icon: "🗑️", label: "Xóa", danger: true, fn: async () => { await api.post("/api/shared/remove", { shareId: sid, id: f.id }); render(); } });
  const menu = (e) => { e.preventDefault(); e.stopPropagation(); showCtx(e, items); };
  el.querySelector(".more").onclick = menu; el.oncontextmenu = menu;
  return el;
}

function toast(msg) { const el = document.createElement("div"); el.className = "toast ok"; el.textContent = msg; $("toasts").appendChild(el); setTimeout(() => el.remove(), 4000); }

render(); refreshStorage(); loadMe(); loadNotifs();
setInterval(loadNotifs, 30000); // kiem tra thong bao moi moi 30s

// ===== Bang DONG BO (chi desktop) - hien file dang upload/download giong Google Drive =====
if (window.dcDesktop && window.dcDesktop.isDesktop && window.dcDesktop.syncActivity) {
  const st = document.createElement("style");
  st.textContent = "@keyframes dcspin{to{transform:rotate(360deg)}} #syncWidget:hover{box-shadow:0 4px 16px rgba(0,0,0,.25)}";
  document.head.appendChild(st);
  const btn = document.createElement("div");
  btn.id = "syncWidget";
  btn.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:95;background:#fff;border:1px solid var(--line,#e0e0e0);border-radius:24px;box-shadow:0 2px 12px rgba(0,0,0,.15);padding:9px 16px;cursor:pointer;font-size:13px;font-weight:600;gap:8px;align-items:center;display:none";
  btn.innerHTML = `<span id="syncIcon" style="display:inline-block">🔄</span> <span id="syncText">Đồng bộ</span>`;
  document.body.appendChild(btn);
  const panel = document.createElement("div");
  panel.id = "syncPanel";
  panel.style.cssText = "position:fixed;bottom:66px;right:20px;z-index:95;background:#fff;border:1px solid var(--line,#e0e0e0);border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.22);width:360px;max-height:420px;overflow:auto;padding:14px;display:none";
  document.body.appendChild(panel);
  let items = [];
  function renderSync() {
    if (!items.length) { panel.innerHTML = `<div style="color:#888;text-align:center;padding:18px">Không có hoạt động đồng bộ</div>`; return; }
    panel.innerHTML = `<div style="font-weight:700;margin-bottom:10px">Hoạt động đồng bộ</div>` + items.map((it) => {
      const arrow = it.type === "up" ? "⬆️" : "⬇️";
      const pct = it.total > 0 ? Math.round((it.loaded / it.total) * 100) : 0;
      const sub = it.status === "done" ? "✓ Xong" : it.status === "error" ? "✗ Lỗi"
        : (it.type === "up" ? `Đang tải lên ${pct ? pct + "%" : "…"}` : "Đang tải về…");
      const col = it.status === "done" ? "#1a8f3c" : it.status === "error" ? "#d33" : "#666";
      return `<div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid #f0f0f0"><span style="font-size:16px">${arrow}</span><div style="flex:1;min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px">${escapeHtml(it.name)}</div><div style="font-size:11px;color:${col}">${sub}</div></div></div>`;
    }).join("");
  }
  btn.onclick = () => { panel.style.display = panel.style.display === "none" ? "block" : "none"; renderSync(); };
  async function pollSync() {
    try {
      const r = await window.dcDesktop.syncActivity();
      items = (r && r.items) || [];
      const active = (r && r.active) || 0;
      btn.style.display = (active > 0 || items.length) ? "inline-flex" : "none";
      $("syncText").textContent = active > 0 ? `Đang đồng bộ ${active}…` : "Đồng bộ";
      $("syncIcon").style.animation = active > 0 ? "dcspin 1.4s linear infinite" : "none";
      if (panel.style.display !== "none") renderSync();
    } catch {}
  }
  setInterval(pollSync, 1500); pollSync();
}

// Driver Cloud - Windows Cloud Files API provider (placeholder/hydration nhu Google Drive).
// Thu muc = "sync root": file hien placeholder (co kich thuoc that, chua tai).
//  - FETCH_PLACEHOLDERS: Windows liet ke thu muc -> ta tra danh sach con (tao placeholder on-demand).
//  - FETCH_DATA: mo file / Available offline -> ta tai du lieu tu cloud ve.
// "Online only" -> Windows tu giai phong dung luong (dehydrate).
#define WIN32_NO_STATUS
#include <windows.h>
#undef WIN32_NO_STATUS
#include <ntstatus.h>
#include <cfapi.h>
#include <node_api.h>
#include <string>
#include <map>
#include <vector>
#include <mutex>
#include <atomic>
#include <thread>
// C++/WinRT cho Storage Provider (menu chuot phai online/offline + icon may/tick + muc trong This PC)
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Provider.h>

#pragma comment(lib, "cldapi.lib")

using namespace winrt::Windows::Storage;
using namespace winrt::Windows::Storage::Provider;

static CF_CONNECTION_KEY g_conn = {};
static bool g_connected = false;
static napi_threadsafe_function g_tsfnData = nullptr; // goi JS onFetch(reqId, id, off, len)
static napi_threadsafe_function g_tsfnList = nullptr; // goi JS onList(reqId, dirPath)
static std::mutex g_mtx;
static std::map<uint32_t, CF_TRANSFER_KEY> g_pendingData;
static std::map<uint32_t, CF_TRANSFER_KEY> g_pendingList;
static std::atomic<uint32_t> g_reqId{1};

struct FetchReq { uint32_t id; std::wstring identity; int64_t offset; int64_t length; };
struct ListReq { uint32_t id; std::wstring dirPath; };

static std::wstring utf8_to_w(napi_env env, napi_value v) {
  size_t len = 0; napi_get_value_string_utf8(env, v, nullptr, 0, &len);
  std::string s(len, '\0'); napi_get_value_string_utf8(env, v, &s[0], len + 1, &len);
  int wlen = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
  std::wstring w(wlen, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &w[0], wlen);
  return w;
}
static std::string w_to_utf8(const std::wstring& w) {
  int len = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(len, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], len, nullptr, nullptr);
  return s;
}

// ---- TSFN -> JS ----
static void CallJsOnFetch(napi_env env, napi_value cb, void*, void* data) {
  FetchReq* r = static_cast<FetchReq*>(data);
  if (env && cb) {
    napi_value undef, args[4]; napi_get_undefined(env, &undef);
    napi_create_uint32(env, r->id, &args[0]);
    std::string id8 = w_to_utf8(r->identity);
    napi_create_string_utf8(env, id8.c_str(), id8.size(), &args[1]);
    napi_create_int64(env, r->offset, &args[2]);
    napi_create_int64(env, r->length, &args[3]);
    napi_call_function(env, undef, cb, 4, args, nullptr);
  }
  delete r;
}
static void CallJsOnList(napi_env env, napi_value cb, void*, void* data) {
  ListReq* r = static_cast<ListReq*>(data);
  if (env && cb) {
    napi_value undef, args[2]; napi_get_undefined(env, &undef);
    napi_create_uint32(env, r->id, &args[0]);
    std::string p8 = w_to_utf8(r->dirPath);
    napi_create_string_utf8(env, p8.c_str(), p8.size(), &args[1]);
    napi_call_function(env, undef, cb, 2, args, nullptr);
  }
  delete r;
}

// ---- CfApi callbacks ----
static void CALLBACK OnFetchData(const CF_CALLBACK_INFO* info, const CF_CALLBACK_PARAMETERS* params) {
  FetchReq* r = new FetchReq();
  r->id = g_reqId.fetch_add(1);
  r->offset = params->FetchData.RequiredFileOffset.QuadPart;
  r->length = params->FetchData.RequiredLength.QuadPart;
  if (info->FileIdentity && info->FileIdentityLength >= sizeof(wchar_t))
    r->identity.assign((const wchar_t*)info->FileIdentity, info->FileIdentityLength / sizeof(wchar_t));
  { std::lock_guard<std::mutex> lk(g_mtx); g_pendingData[r->id] = info->TransferKey; }
  if (g_tsfnData) napi_call_threadsafe_function(g_tsfnData, r, napi_tsfn_nonblocking); else delete r;
}
static void CALLBACK OnFetchPlaceholders(const CF_CALLBACK_INFO* info, const CF_CALLBACK_PARAMETERS* params) {
  ListReq* r = new ListReq();
  r->id = g_reqId.fetch_add(1);
  if (info->NormalizedPath) r->dirPath.assign(info->NormalizedPath);
  { std::lock_guard<std::mutex> lk(g_mtx); g_pendingList[r->id] = info->TransferKey; }
  if (g_tsfnList) napi_call_threadsafe_function(g_tsfnList, r, napi_tsfn_nonblocking); else delete r;
}

// ================= ham xuat JS =================
// register(rootPath, name, ver, iconResource, id) -> HRESULT
// Dung StorageProviderSyncRootManager (WinRT) = cach OneDrive/Google: cho menu chuot phai
// "Free up space"/"Always keep on this device" + icon may/tick + muc trong This PC.
// Chay tren luong MTA rieng de tranh deadlock STA cua tien trinh Electron.
static napi_value Register(napi_env env, napi_callback_info cbi) {
  size_t argc = 5; napi_value argv[5]; napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring root = utf8_to_w(env, argv[0]), name = utf8_to_w(env, argv[1]), ver = utf8_to_w(env, argv[2]),
               icon = utf8_to_w(env, argv[3]), id = utf8_to_w(env, argv[4]);
  HRESULT hr = E_FAIL;
  std::thread t([&]() {
    try {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      auto folder = StorageFolder::GetFolderFromPathAsync(winrt::hstring(root)).get();
      StorageProviderSyncRootInfo info;
      info.Id(winrt::hstring(id));
      info.Path(folder);
      info.DisplayNameResource(winrt::hstring(name));
      info.IconResource(winrt::hstring(icon));
      info.Version(winrt::hstring(ver));
      info.HydrationPolicy(StorageProviderHydrationPolicy::Full);
      info.HydrationPolicyModifier(StorageProviderHydrationPolicyModifier::None);
      info.PopulationPolicy(StorageProviderPopulationPolicy::Full);
      info.InSyncPolicy(StorageProviderInSyncPolicy::Default);
      info.HardlinkPolicy(StorageProviderHardlinkPolicy::None);
      info.ShowSiblingsAsGroup(false);
      info.ProtectionMode(StorageProviderProtectionMode::Unknown);
      StorageProviderSyncRootManager::Register(info);
      hr = S_OK;
    } catch (winrt::hresult_error const& e) { hr = e.code(); }
    catch (...) { hr = E_FAIL; }
  });
  t.join();
  napi_value out; napi_create_int32(env, (int32_t)hr, &out); return out;
}

// connect(rootPath, onFetchData, onListDir) -> HRESULT
static napi_value Connect(napi_env env, napi_callback_info cbi) {
  size_t argc = 3; napi_value argv[3]; napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring root = utf8_to_w(env, argv[0]);
  napi_value n1, n2;
  napi_create_string_utf8(env, "dcData", NAPI_AUTO_LENGTH, &n1);
  napi_create_string_utf8(env, "dcList", NAPI_AUTO_LENGTH, &n2);
  napi_create_threadsafe_function(env, argv[1], nullptr, n1, 0, 1, nullptr, nullptr, nullptr, CallJsOnFetch, &g_tsfnData);
  napi_create_threadsafe_function(env, argv[2], nullptr, n2, 0, 1, nullptr, nullptr, nullptr, CallJsOnList, &g_tsfnList);
  CF_CALLBACK_REGISTRATION cbs[] = {
    { CF_CALLBACK_TYPE_FETCH_DATA, OnFetchData },
    { CF_CALLBACK_TYPE_FETCH_PLACEHOLDERS, OnFetchPlaceholders },
    CF_CALLBACK_REGISTRATION_END
  };
  HRESULT hr = CfConnectSyncRoot(root.c_str(), cbs, nullptr,
    (CF_CONNECT_FLAGS)(CF_CONNECT_FLAG_REQUIRE_PROCESS_INFO | CF_CONNECT_FLAG_REQUIRE_FULL_FILE_PATH), &g_conn);
  g_connected = SUCCEEDED(hr);
  napi_value out; napi_create_int32(env, (int32_t)hr, &out); return out;
}

// createPlaceholder(baseDir, relativeName, fileIdentity, size, isDir) -> HRESULT (it dung; chu yeu on-demand)
static napi_value CreatePlaceholder(napi_env env, napi_callback_info cbi) {
  size_t argc = 5; napi_value argv[5]; napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring base = utf8_to_w(env, argv[0]), rel = utf8_to_w(env, argv[1]), identity = utf8_to_w(env, argv[2]);
  int64_t size = 0; napi_get_value_int64(env, argv[3], &size);
  bool isDir = false; napi_get_value_bool(env, argv[4], &isDir);
  CF_PLACEHOLDER_CREATE_INFO ci = {};
  ci.RelativeFileName = rel.c_str();
  ci.FsMetadata.FileSize.QuadPart = isDir ? 0 : size;
  ci.FsMetadata.BasicInfo.FileAttributes = isDir ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_NORMAL;
  ci.FileIdentity = identity.c_str();
  ci.FileIdentityLength = (DWORD)((identity.size() + 1) * sizeof(wchar_t));
  ci.Flags = CF_PLACEHOLDER_CREATE_FLAG_MARK_IN_SYNC;
  DWORD processed = 0;
  HRESULT hr = CfCreatePlaceholders(base.c_str(), &ci, 1, CF_CREATE_FLAG_NONE, &processed);
  napi_value out; napi_create_int32(env, (int32_t)hr, &out); return out;
}

// transferData(reqId, buffer, offset) -> HRESULT
static napi_value TransferData(napi_env env, napi_callback_info cbi) {
  size_t argc = 3; napi_value argv[3]; napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  uint32_t id = 0; napi_get_value_uint32(env, argv[0], &id);
  void* data = nullptr; size_t dataLen = 0; napi_get_buffer_info(env, argv[1], &data, &dataLen);
  int64_t offset = 0; napi_get_value_int64(env, argv[2], &offset);
  CF_TRANSFER_KEY tk;
  { std::lock_guard<std::mutex> lk(g_mtx); auto it = g_pendingData.find(id);
    if (it == g_pendingData.end()) { napi_value o; napi_create_int32(env, (int32_t)E_INVALIDARG, &o); return o; }
    tk = it->second; g_pendingData.erase(it); }
  CF_OPERATION_INFO oi = {}; oi.StructSize = sizeof(oi);
  oi.Type = CF_OPERATION_TYPE_TRANSFER_DATA; oi.ConnectionKey = g_conn; oi.TransferKey = tk;
  CF_OPERATION_PARAMETERS op = {};
  op.ParamSize = FIELD_OFFSET(CF_OPERATION_PARAMETERS, TransferData) + sizeof(op.TransferData);
  op.TransferData.CompletionStatus = STATUS_SUCCESS;
  op.TransferData.Buffer = data;
  op.TransferData.Offset.QuadPart = offset;
  op.TransferData.Length.QuadPart = (LONGLONG)dataLen;
  HRESULT hr = CfExecute(&oi, &op);
  napi_value out; napi_create_int32(env, (int32_t)hr, &out); return out;
}

// transferPlaceholders(reqId, entriesString) -> HRESULT
// entriesString: moi dong "name\tD\tsize\tid" (D=1 neu thu muc)
static napi_value TransferPlaceholders(napi_env env, napi_callback_info cbi) {
  size_t argc = 2; napi_value argv[2]; napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  uint32_t id = 0; napi_get_value_uint32(env, argv[0], &id);
  std::wstring entries = utf8_to_w(env, argv[1]);
  CF_TRANSFER_KEY tk;
  { std::lock_guard<std::mutex> lk(g_mtx); auto it = g_pendingList.find(id);
    if (it == g_pendingList.end()) { napi_value o; napi_create_int32(env, (int32_t)E_INVALIDARG, &o); return o; }
    tk = it->second; g_pendingList.erase(it); }

  // parse entries -> backing storage (phai song trong suot CfExecute)
  std::vector<std::wstring> names, ids;
  std::vector<bool> dirs; std::vector<int64_t> sizes;
  size_t pos = 0;
  while (pos < entries.size()) {
    size_t eol = entries.find(L'\n', pos);
    std::wstring line = entries.substr(pos, eol == std::wstring::npos ? std::wstring::npos : eol - pos);
    pos = (eol == std::wstring::npos) ? entries.size() : eol + 1;
    if (line.empty()) continue;
    size_t t1 = line.find(L'\t'), t2 = line.find(L'\t', t1 + 1), t3 = line.find(L'\t', t2 + 1);
    if (t1 == std::wstring::npos || t2 == std::wstring::npos || t3 == std::wstring::npos) continue;
    names.push_back(line.substr(0, t1));
    dirs.push_back(line.substr(t1 + 1, t2 - t1 - 1) == L"1");
    sizes.push_back(_wtoi64(line.substr(t2 + 1, t3 - t2 - 1).c_str()));
    ids.push_back(line.substr(t3 + 1));
  }
  std::vector<CF_PLACEHOLDER_CREATE_INFO> arr(names.size());
  for (size_t i = 0; i < names.size(); i++) {
    CF_PLACEHOLDER_CREATE_INFO& ci = arr[i];
    ZeroMemory(&ci, sizeof(ci));
    ci.RelativeFileName = names[i].c_str();
    ci.FsMetadata.FileSize.QuadPart = dirs[i] ? 0 : sizes[i];
    ci.FsMetadata.BasicInfo.FileAttributes = dirs[i] ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_NORMAL;
    ci.FileIdentity = ids[i].c_str();
    ci.FileIdentityLength = (DWORD)((ids[i].size() + 1) * sizeof(wchar_t));
    ci.Flags = CF_PLACEHOLDER_CREATE_FLAG_MARK_IN_SYNC;
  }
  CF_OPERATION_INFO oi = {}; oi.StructSize = sizeof(oi);
  oi.Type = CF_OPERATION_TYPE_TRANSFER_PLACEHOLDERS; oi.ConnectionKey = g_conn; oi.TransferKey = tk;
  CF_OPERATION_PARAMETERS op = {};
  op.ParamSize = FIELD_OFFSET(CF_OPERATION_PARAMETERS, TransferPlaceholders) + sizeof(op.TransferPlaceholders);
  op.TransferPlaceholders.Flags = CF_OPERATION_TRANSFER_PLACEHOLDERS_FLAG_DISABLE_ON_DEMAND_POPULATION;
  op.TransferPlaceholders.CompletionStatus = STATUS_SUCCESS;
  op.TransferPlaceholders.PlaceholderTotalCount.QuadPart = (LONGLONG)arr.size();
  op.TransferPlaceholders.PlaceholderArray = arr.empty() ? nullptr : arr.data();
  op.TransferPlaceholders.PlaceholderCount = (DWORD)arr.size();
  op.TransferPlaceholders.EntriesProcessed = 0;
  HRESULT hr = CfExecute(&oi, &op);
  napi_value out; napi_create_int32(env, (int32_t)hr, &out); return out;
}

static napi_value Disconnect(napi_env env, napi_callback_info) {
  if (g_connected) { CfDisconnectSyncRoot(g_conn); g_connected = false; }
  if (g_tsfnData) { napi_release_threadsafe_function(g_tsfnData, napi_tsfn_release); g_tsfnData = nullptr; }
  if (g_tsfnList) { napi_release_threadsafe_function(g_tsfnList, napi_tsfn_release); g_tsfnList = nullptr; }
  napi_value out; napi_get_undefined(env, &out); return out;
}
static napi_value Unregister(napi_env env, napi_callback_info cbi) {
  size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring root = utf8_to_w(env, argv[0]);
  HRESULT hr = CfUnregisterSyncRoot(root.c_str());
  napi_value out; napi_create_int32(env, (int32_t)hr, &out); return out;
}
// unregisterSp(id) -> go dang ky Storage Provider (WinRT)
static napi_value UnregisterSp(napi_env env, napi_callback_info cbi) {
  size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring id = utf8_to_w(env, argv[0]);
  HRESULT hr = E_FAIL;
  std::thread t([&]() {
    try { winrt::init_apartment(winrt::apartment_type::multi_threaded); StorageProviderSyncRootManager::Unregister(winrt::hstring(id)); hr = S_OK; }
    catch (winrt::hresult_error const& e) { hr = e.code(); } catch (...) { hr = E_FAIL; }
  });
  t.join();
  napi_value out; napi_create_int32(env, (int32_t)hr, &out); return out;
}
// hydrate(fullPath) -> tai du lieu ve may (OFFLINE). Chay LUONG NEN (fire-and-forget):
// CfHydratePlaceholder kich hoat FETCH_DATA -> can luong JS ranh de phuc vu -> KHONG duoc block luong JS.
static napi_value Hydrate(napi_env env, napi_callback_info cbi) {
  size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring* pp = new std::wstring(utf8_to_w(env, argv[0]));
  std::thread([pp]() {
    HANDLE h = CreateFileW(pp->c_str(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (h != INVALID_HANDLE_VALUE) {
      LARGE_INTEGER off = {}; LARGE_INTEGER len; len.QuadPart = -1;
      if (SUCCEEDED(CfHydratePlaceholder(h, off, len, CF_HYDRATE_FLAG_NONE, nullptr)))
        CfSetPinState(h, CF_PIN_STATE_PINNED, (CF_SET_PIN_FLAGS)0, nullptr);
      CloseHandle(h);
    }
    delete pp;
  }).detach();
  napi_value out; napi_create_int32(env, 0, &out); return out; // 0 = da bat dau tai (chay ngam)
}
// dehydrate(fullPath) -> giai phong du lieu local (file thanh ONLINE placeholder), du lieu van o cloud
static napi_value Dehydrate(napi_env env, napi_callback_info cbi) {
  size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring p = utf8_to_w(env, argv[0]);
  HANDLE h = CreateFileW(p.c_str(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
  HRESULT hr = E_FAIL;
  if (h != INVALID_HANDLE_VALUE) {
    CfSetPinState(h, CF_PIN_STATE_UNPINNED, (CF_SET_PIN_FLAGS)0, nullptr); // bo ghim de dehydrate duoc
    LARGE_INTEGER off = {}; LARGE_INTEGER len; len.QuadPart = -1; // ca file
    hr = CfDehydratePlaceholder(h, off, len, CF_DEHYDRATE_FLAG_NONE, nullptr);
    CloseHandle(h);
  } else hr = HRESULT_FROM_WIN32(GetLastError());
  napi_value out; napi_create_int32(env, (int32_t)hr, &out); return out;
}

// convert(fullPath, fileId, dehydrate) -> bien file FULL (vua copy vao) thanh placeholder in-sync;
// dehydrate=true -> giai phong luon (file thanh ONLINE 0 byte). Chay luong nen.
static napi_value Convert(napi_env env, napi_callback_info cbi) {
  size_t argc = 3; napi_value argv[3]; napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring* pp = new std::wstring(utf8_to_w(env, argv[0]));
  std::wstring* id = new std::wstring(utf8_to_w(env, argv[1]));
  bool dehy = false; napi_get_value_bool(env, argv[2], &dehy);
  std::thread([pp, id, dehy]() {
    HANDLE h = CreateFileW(pp->c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (h != INVALID_HANDLE_VALUE) {
      CF_CONVERT_FLAGS flags = CF_CONVERT_FLAG_MARK_IN_SYNC;
      if (dehy) flags = (CF_CONVERT_FLAGS)(flags | CF_CONVERT_FLAG_DEHYDRATE);
      USN usn = 0;
      CfConvertToPlaceholder(h, id->c_str(), (DWORD)((id->size() + 1) * sizeof(wchar_t)), flags, &usn, nullptr);
      CloseHandle(h);
    }
    delete pp; delete id;
  }).detach();
  napi_value out; napi_create_int32(env, 0, &out); return out;
}

// isPlaceholder(path) -> true neu la file cloud ONLINE (placeholder, chua tai) -> watcher bo qua, khong re-upload
static napi_value IsPlaceholder(napi_env env, napi_callback_info cbi) {
  size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring p = utf8_to_w(env, argv[0]);
  DWORD a = GetFileAttributesW(p.c_str());
  bool ph = (a != INVALID_FILE_ATTRIBUTES) && ((a & FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS) != 0);
  napi_value out; napi_get_boolean(env, ph, &out); return out;
}

static napi_value Init(napi_env env, napi_value exports) {
  auto reg = [&](const char* n, napi_callback f) {
    napi_value fn; napi_create_function(env, n, NAPI_AUTO_LENGTH, f, nullptr, &fn);
    napi_set_named_property(env, exports, n, fn);
  };
  reg("register", Register);
  reg("unregisterSp", UnregisterSp);
  reg("dehydrate", Dehydrate);
  reg("hydrate", Hydrate);
  reg("convert", Convert);
  reg("isPlaceholder", IsPlaceholder);
  reg("connect", Connect);
  reg("createPlaceholder", CreatePlaceholder);
  reg("transferData", TransferData);
  reg("transferPlaceholders", TransferPlaceholders);
  reg("disconnect", Disconnect);
  reg("unregister", Unregister);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

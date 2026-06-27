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

#pragma comment(lib, "cldapi.lib")

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
static napi_value Register(napi_env env, napi_callback_info cbi) {
  size_t argc = 3; napi_value argv[3]; napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring root = utf8_to_w(env, argv[0]), name = utf8_to_w(env, argv[1]), ver = utf8_to_w(env, argv[2]);
  CF_SYNC_REGISTRATION reg = {}; reg.StructSize = sizeof(reg);
  reg.ProviderName = name.c_str(); reg.ProviderVersion = ver.c_str();
  CF_SYNC_POLICIES pol = {}; pol.StructSize = sizeof(pol);
  pol.Hydration.Primary = CF_HYDRATION_POLICY_PARTIAL;
  pol.Hydration.Modifier = CF_HYDRATION_POLICY_MODIFIER_NONE;
  pol.Population.Primary = CF_POPULATION_POLICY_PARTIAL; // on-demand: Windows goi FETCH_PLACEHOLDERS
  pol.Population.Modifier = CF_POPULATION_POLICY_MODIFIER_NONE;
  pol.InSync = CF_INSYNC_POLICY_TRACK_ALL;
  pol.HardLink = CF_HARDLINK_POLICY_NONE;
  HRESULT hr = CfRegisterSyncRoot(root.c_str(), &reg, &pol, CF_REGISTER_FLAG_UPDATE);
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

static napi_value Init(napi_env env, napi_value exports) {
  auto reg = [&](const char* n, napi_callback f) {
    napi_value fn; napi_create_function(env, n, NAPI_AUTO_LENGTH, f, nullptr, &fn);
    napi_set_named_property(env, exports, n, fn);
  };
  reg("register", Register);
  reg("connect", Connect);
  reg("createPlaceholder", CreatePlaceholder);
  reg("transferData", TransferData);
  reg("transferPlaceholders", TransferPlaceholders);
  reg("disconnect", Disconnect);
  reg("unregister", Unregister);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

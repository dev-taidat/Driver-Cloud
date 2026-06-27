// Driver Cloud - Windows Cloud Files API provider (placeholder/hydration nhu Google Drive).
// Dang ky 1 thu muc lam "sync root": file hien ra duoi dang placeholder (co kich thuoc that,
// chua tai). Khi mo / chon "Available offline" -> Windows goi FETCH_DATA -> ta tai tu cloud ve.
// Chon "Online only" -> Windows tu giai phong dung luong (dehydrate).
#define WIN32_NO_STATUS
#include <windows.h>
#undef WIN32_NO_STATUS
#include <ntstatus.h>
#include <cfapi.h>
#include <node_api.h>
#include <string>
#include <map>
#include <mutex>
#include <atomic>
#include <vector>

#pragma comment(lib, "cldapi.lib")

// ---- trang thai toan cuc ----
static CF_CONNECTION_KEY g_conn = {};
static bool g_connected = false;
static napi_threadsafe_function g_tsfn = nullptr; // goi JS onFetch
static std::mutex g_mtx;
static std::map<uint32_t, CF_TRANSFER_KEY> g_pending; // requestId -> transferKey
static std::atomic<uint32_t> g_reqId{1};

// du lieu mot yeu cau fetch chuyen sang JS
struct FetchReq {
  uint32_t id;
  std::wstring identity; // cloud file id (FileIdentity)
  int64_t offset;
  int64_t length;
};

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

// ---- callback chay tren luong cua TSFN: dung de goi ham JS onFetch(requestId, identity, offset, length) ----
static void CallJsOnFetch(napi_env env, napi_value js_cb, void* /*ctx*/, void* data) {
  FetchReq* r = static_cast<FetchReq*>(data);
  if (env && js_cb) {
    napi_value undef, args[4];
    napi_get_undefined(env, &undef);
    napi_create_uint32(env, r->id, &args[0]);
    std::string id8 = w_to_utf8(r->identity);
    napi_create_string_utf8(env, id8.c_str(), id8.size(), &args[1]);
    napi_create_int64(env, r->offset, &args[2]);
    napi_create_int64(env, r->length, &args[3]);
    napi_call_function(env, undef, js_cb, 4, args, nullptr);
  }
  delete r;
}

// ---- CfApi callback: Windows can du lieu file (mo / hydrate / offline) ----
static void CALLBACK OnFetchData(const CF_CALLBACK_INFO* info, const CF_CALLBACK_PARAMETERS* params) {
  FetchReq* r = new FetchReq();
  r->id = g_reqId.fetch_add(1);
  r->offset = params->FetchData.RequiredFileOffset.QuadPart;
  r->length = params->FetchData.RequiredLength.QuadPart;
  if (info->FileIdentity && info->FileIdentityLength >= sizeof(wchar_t)) {
    r->identity.assign((const wchar_t*)info->FileIdentity, info->FileIdentityLength / sizeof(wchar_t));
  }
  {
    std::lock_guard<std::mutex> lk(g_mtx);
    g_pending[r->id] = info->TransferKey;
  }
  if (g_tsfn) napi_call_threadsafe_function(g_tsfn, r, napi_tsfn_nonblocking);
  else delete r;
}

// =================== ham xuat sang JS ===================

// register(rootPath, providerName, providerVersion)
static napi_value Register(napi_env env, napi_callback_info cbi) {
  size_t argc = 3; napi_value argv[3];
  napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring root = utf8_to_w(env, argv[0]);
  std::wstring name = utf8_to_w(env, argv[1]);
  std::wstring ver = utf8_to_w(env, argv[2]);

  CF_SYNC_REGISTRATION reg = {};
  reg.StructSize = sizeof(reg);
  reg.ProviderName = name.c_str();
  reg.ProviderVersion = ver.c_str();

  CF_SYNC_POLICIES pol = {};
  pol.StructSize = sizeof(pol);
  pol.Hydration.Primary = CF_HYDRATION_POLICY_PARTIAL;
  pol.Hydration.Modifier = CF_HYDRATION_POLICY_MODIFIER_NONE;
  pol.Population.Primary = CF_POPULATION_POLICY_FULL;
  pol.Population.Modifier = CF_POPULATION_POLICY_MODIFIER_NONE;
  pol.InSync = CF_INSYNC_POLICY_TRACK_ALL;
  pol.HardLink = CF_HARDLINK_POLICY_NONE;

  HRESULT hr = CfRegisterSyncRoot(root.c_str(), &reg, &pol, CF_REGISTER_FLAG_UPDATE);
  napi_value out; napi_create_int32(env, (int32_t)hr, &out); return out;
}

// connect(rootPath, onFetch)  -> tra ve HRESULT
static napi_value Connect(napi_env env, napi_callback_info cbi) {
  size_t argc = 2; napi_value argv[2];
  napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring root = utf8_to_w(env, argv[0]);

  napi_value res_name; napi_create_string_utf8(env, "dcOnFetch", NAPI_AUTO_LENGTH, &res_name);
  napi_create_threadsafe_function(env, argv[1], nullptr, res_name, 0, 1, nullptr, nullptr, nullptr,
                                   CallJsOnFetch, &g_tsfn);

  CF_CALLBACK_REGISTRATION cbs[] = {
    { CF_CALLBACK_TYPE_FETCH_DATA, OnFetchData },
    CF_CALLBACK_REGISTRATION_END
  };
  HRESULT hr = CfConnectSyncRoot(root.c_str(), cbs, nullptr,
    (CF_CONNECT_FLAGS)(CF_CONNECT_FLAG_REQUIRE_PROCESS_INFO | CF_CONNECT_FLAG_REQUIRE_FULL_FILE_PATH),
    &g_conn);
  g_connected = SUCCEEDED(hr);
  napi_value out; napi_create_int32(env, (int32_t)hr, &out); return out;
}

// createPlaceholder(baseDir, relativeName, fileIdentity, size, isDir) -> HRESULT
static napi_value CreatePlaceholder(napi_env env, napi_callback_info cbi) {
  size_t argc = 5; napi_value argv[5];
  napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  std::wstring base = utf8_to_w(env, argv[0]);
  std::wstring rel = utf8_to_w(env, argv[1]);
  std::wstring identity = utf8_to_w(env, argv[2]);
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

// transferData(requestId, buffer, offset) -> HRESULT (goi tu JS sau khi tai xong)
static napi_value TransferData(napi_env env, napi_callback_info cbi) {
  size_t argc = 3; napi_value argv[3];
  napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
  uint32_t id = 0; napi_get_value_uint32(env, argv[0], &id);
  void* data = nullptr; size_t dataLen = 0;
  napi_get_buffer_info(env, argv[1], &data, &dataLen);
  int64_t offset = 0; napi_get_value_int64(env, argv[2], &offset);

  CF_TRANSFER_KEY tk;
  {
    std::lock_guard<std::mutex> lk(g_mtx);
    auto it = g_pending.find(id);
    if (it == g_pending.end()) { napi_value o; napi_create_int32(env, (int32_t)E_INVALIDARG, &o); return o; }
    tk = it->second; g_pending.erase(it);
  }

  CF_OPERATION_INFO oi = {};
  oi.StructSize = sizeof(oi);
  oi.Type = CF_OPERATION_TYPE_TRANSFER_DATA;
  oi.ConnectionKey = g_conn;
  oi.TransferKey = tk;
  CF_OPERATION_PARAMETERS op = {};
  op.ParamSize = FIELD_OFFSET(CF_OPERATION_PARAMETERS, TransferData) + sizeof(op.TransferData);
  op.TransferData.CompletionStatus = STATUS_SUCCESS;
  op.TransferData.Buffer = data;
  op.TransferData.Offset.QuadPart = offset;
  op.TransferData.Length.QuadPart = (LONGLONG)dataLen;
  HRESULT hr = CfExecute(&oi, &op);
  napi_value out; napi_create_int32(env, (int32_t)hr, &out); return out;
}

// disconnect() / unregister(rootPath)
static napi_value Disconnect(napi_env env, napi_callback_info cbi) {
  if (g_connected) { CfDisconnectSyncRoot(g_conn); g_connected = false; }
  if (g_tsfn) { napi_release_threadsafe_function(g_tsfn, napi_tsfn_release); g_tsfn = nullptr; }
  napi_value out; napi_get_undefined(env, &out); return out;
}
static napi_value Unregister(napi_env env, napi_callback_info cbi) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, cbi, &argc, argv, nullptr, nullptr);
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
  reg("disconnect", Disconnect);
  reg("unregister", Unregister);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

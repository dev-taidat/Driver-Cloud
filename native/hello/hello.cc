#include <node_api.h>
napi_value Hello(napi_env env, napi_callback_info info){
  napi_value s; napi_create_string_utf8(env, "ok-native-cloudfiles-ready", NAPI_AUTO_LENGTH, &s); return s;
}
napi_value Init(napi_env env, napi_value exports){
  napi_value fn; napi_create_function(env, "hello", NAPI_AUTO_LENGTH, Hello, NULL, &fn);
  napi_set_named_property(env, exports, "hello", fn); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

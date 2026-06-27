{
  "targets": [
    {
      "target_name": "cloudfiles",
      "sources": [ "cloud_provider.cc" ],
      "defines": [ "UNICODE", "_UNICODE", "NOMINMAX", "NAPI_VERSION=8" ],
      "libraries": [ "cldapi.lib" ],
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": [ "/std:c++17" ] }
      }
    }
  ]
}

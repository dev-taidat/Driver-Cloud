{
  "targets": [
    {
      "target_name": "cloudfiles",
      "sources": [ "cloud_provider.cc" ],
      "defines": [ "UNICODE", "_UNICODE", "NOMINMAX", "NAPI_VERSION=8" ],
      "libraries": [ "cldapi.lib", "WindowsApp.lib" ],
      "include_dirs": [
        "C:/Program Files (x86)/Windows Kits/10/Include/10.0.22621.0/cppwinrt"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": [ "/std:c++17", "/EHsc" ] }
      }
    }
  ]
}

const cf=require("./build/Release/cloudfiles.node");const fs=require("fs");const os=require("os");const path=require("path");
const root=path.join(os.homedir(),"DriverCloudTest");
console.log("unregister:", "0x"+(cf.unregister(root)>>>0).toString(16));
try{fs.rmSync(root,{recursive:true,force:true});console.log("da xoa folder test");}catch(e){console.log("xoa loi:",e.message);}

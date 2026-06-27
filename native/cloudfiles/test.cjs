// Test provider Cloud Files: dang ky 1 thu muc, tao 1 placeholder, phuc vu du lieu khi doc.
const cf = require("./build/Release/cloudfiles.node");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.join(os.homedir(), "DriverCloudTest");
fs.mkdirSync(root, { recursive: true });

const CONTENT = Buffer.from("HELLO FROM CLOUD - day la noi dung tai tu cloud ve khi ban mo file.\n".repeat(20), "utf8");

const hrReg = cf.register(root, "DriverCloud", "1.0");
console.log("register HRESULT =", "0x" + (hrReg >>> 0).toString(16));

// onFetch chay khi Windows can du lieu (mo file / Available offline)
const hrConn = cf.connect(root, (reqId, identity, offset, length) => {
  console.log(`[FETCH] reqId=${reqId} id="${identity.replace(/\0/g,'')}" offset=${offset} length=${length}`);
  // tra ve toan bo noi dung tu offset
  const off = Number(offset);
  const buf = CONTENT.subarray(off, off + Number(length));
  const hr = cf.transferData(reqId, buf, off);
  console.log("  transferData HRESULT =", "0x" + (hr >>> 0).toString(16));
});
console.log("connect HRESULT =", "0x" + (hrConn >>> 0).toString(16));

const hrPh = cf.createPlaceholder(root, "hello-cloud.txt", "fileid-1", CONTENT.length, false);
console.log("createPlaceholder HRESULT =", "0x" + (hrPh >>> 0).toString(16));
console.log("ROOT:", root);
console.log("San sang. Doc file de kich hoat tai du lieu...");

// giu tien trinh song de phuc vu callback
setInterval(() => {}, 1000);

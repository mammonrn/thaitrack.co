/* สร้างจาก lib/install-prompt-capture.ts — ห้ามแก้ไฟล์นี้ตรงๆ
   ชื่อ key กับชื่อ event ต้องตรงกับที่ hook อ่าน มีเทสต์เฝ้าอยู่
   (ดู lib/install-prompt-capture.test.ts) */
(function(){try{
var w=window;
w.__thaitrackInstallPrompt=null;
w.addEventListener("beforeinstallprompt",function(e){
e.preventDefault();
w.__thaitrackInstallPrompt=e;
w.dispatchEvent(new Event("thaitrack:install-prompt-captured"));
});
w.addEventListener("appinstalled",function(){w.__thaitrackInstallPrompt=null;});
}catch(err){}})();

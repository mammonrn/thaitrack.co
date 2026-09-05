/**
 * ดักจับ beforeinstallprompt ตั้งแต่ก่อน React ตื่น
 *
 * ── บั๊กที่แก้ (วัดจากของจริงด้วย chromium) ─────────────────────────────
 * useInstallState() ผูก listener ของ beforeinstallprompt ใน useEffect ซึ่งทำงาน
 * หลัง hydration · วัดบนเครื่องจริงได้ **339–478 ms** หลังสคริปต์ตัวแรกเริ่มทำงาน
 *
 * Chrome ยิง beforeinstallprompt ทันทีที่เว็บผ่านเกณฑ์ติดตั้ง ซึ่งในการเข้าครั้งที่
 * สองเป็นต้นไป (service worker ลงแล้ว manifest อยู่ใน cache แล้ว) เกิดขึ้นได้
 * **ก่อน** React hydrate เสร็จ · event ที่ยิงตอนไม่มี listener หายไปเลย ไม่มี
 * ทางเรียกคืน แล้ว state จะตกเป็น unsupported หลัง 1200 ms
 *
 * ผลคือการ์ดชวนติดตั้ง "ไม่มีวันขึ้น" สำหรับ page load นั้น โดยไม่มี error
 * ไม่มีอะไรพัง และไม่มีตัวเลขไหนบอกได้ว่าเสียโอกาสไปเท่าไร
 *
 * พิสูจน์แล้วด้วยการยิง event ปลอมสองจังหวะบนเว็บที่ build จริง:
 *   ยิงที่ 0 ms   (ก่อน listener) → การ์ดไม่ขึ้นเลย
 *   ยิงที่ 3000 ms (หลัง listener) → การ์ดขึ้นปกติ
 *
 * ── ทางแก้ ──────────────────────────────────────────────────────────
 * สคริปต์เล็กๆ ใน <head> ที่ทำงานก่อนอะไรทั้งหมด ดักไว้แล้วเก็บใส่ window
 * ให้ hook มาหยิบทีหลัง · เป็นวิธีมาตรฐานของ PWA ทั่วไป ไม่ใช่ท่าพิเศษ
 *
 * ⚠️ สคริปต์ต้อง **สั้นและไม่พึ่งอะไรเลย** เพราะรันก่อน bundle ทุกตัว ถ้ามัน
 * โยน error หน้าเว็บทั้งหน้าจะพังตั้งแต่ยังไม่เริ่ม จึงห่อ try/catch ไว้ทั้งก้อน
 */

/** ที่เก็บ event ที่ดักไว้ได้ บน window */
export const CAPTURED_PROMPT_KEY = "__thaitrackInstallPrompt";

/** event ที่สคริปต์ยิงบอก React ว่า "ดักได้แล้วนะ" */
export const PROMPT_CAPTURED_EVENT = "thaitrack:install-prompt-captured";

/**
 * ตัวสคริปต์ที่ฝังใน <head>
 *
 * เขียนเป็น ES5 ล้วนโดยตั้งใจ — ไม่ผ่าน bundler ไม่ผ่าน transpiler จึงต้อง
 * ทำงานได้บนทุกเบราว์เซอร์ที่เปิดเว็บนี้ได้ ไม่ใช่แค่ตัวที่รองรับไวยากรณ์ใหม่
 *
 * เก็บเป็นสตริงในไฟล์ TypeScript แทนไฟล์ .js แยก เพราะชื่อ key กับชื่อ event
 * ต้องตรงกับที่ hook อ่านเป๊ะๆ การมีนิยามเดียวทำให้ไม่มีทางเพี้ยนจากกัน
 */
export const CAPTURE_SCRIPT = `(function(){try{
var w=window;
w.${CAPTURED_PROMPT_KEY}=null;
w.addEventListener("beforeinstallprompt",function(e){
e.preventDefault();
w.${CAPTURED_PROMPT_KEY}=e;
w.dispatchEvent(new Event("${PROMPT_CAPTURED_EVENT}"));
});
w.addEventListener("appinstalled",function(){w.${CAPTURED_PROMPT_KEY}=null;});
}catch(err){}})();`;

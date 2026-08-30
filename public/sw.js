/**
 * Service worker ขั้นต่ำ
 *
 * มีไว้เพื่อให้เบราว์เซอร์ยอมให้ติดตั้งเป็นแอพ (Chrome บังคับว่าต้องมี service
 * worker ที่ดัก fetch อย่างน้อยหนึ่งตัว) ยังไม่ได้ทำ offline mode จึงส่งทุก
 * request ต่อไปยังเครือข่ายตามปกติ ไม่แคชอะไรทั้งสิ้น
 *
 * ที่ไม่แคชเพราะข้อมูลสถานะพัสดุเปลี่ยนตลอดเวลา การแคชผิดจังหวะจะทำให้ผู้ใช้
 * เห็นสถานะเก่าโดยไม่รู้ตัว ซึ่งแย่กว่าการโหลดใหม่ทุกครั้ง
 */

self.addEventListener("install", () => {
  // ข้ามคิวรอ ให้ตัวใหม่ทำงานทันทีตอน deploy เวอร์ชันถัดไป
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // ต้องมี handler นี้เบราว์เซอร์ถึงจะถือว่าเป็น PWA ที่ติดตั้งได้
  event.respondWith(fetch(event.request));
});

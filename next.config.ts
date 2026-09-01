import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * ให้ URL ภาษาไทยของหน้ารหัสไปรษณีย์ชี้ไปที่โฟลเดอร์ชื่ออังกฤษ
   *
   * ------------------------------------------------------------------
   * ⚠️ ทำไมต้องมี rewrite แทนที่จะตั้งชื่อโฟลเดอร์เป็นภาษาไทยไปเลย
   *
   * Next 16.3.3 (Turbopack) สร้าง static page ไม่ผ่านเมื่อ **ชื่อโฟลเดอร์**
   * ของ route เป็นภาษาไทย — ล้มด้วย InvalidCharacterError ตั้งแต่หน้าแรกที่
   * generate (ยืนยันแล้วด้วยการเปลี่ยนชื่อโฟลเดอร์เป็นอังกฤษแล้ว build ผ่าน
   * ทั้ง 1,027 หน้า) ส่วน **ค่าของ dynamic segment** ที่เป็นภาษาไทยไม่มีปัญหา
   * ซึ่งเป็นเหตุผลที่หน้า landing รายขนส่ง (/เช็คพัสดุ-flash) ใช้ [carrier]
   * ที่ระดับบนสุดได้โดยไม่ต้องพึ่ง rewrite
   *
   * rewrite ทำงานฝั่งเซิร์ฟเวอร์และผู้ใช้มองไม่เห็น URL ปลายทาง — ทั้ง canonical,
   * sitemap และลิงก์ในเว็บจึงเป็นภาษาไทยทั้งหมดตามที่ตั้งใจ
   * ------------------------------------------------------------------
   */
  async rewrites() {
    // เขียน source เป็นรูป percent-encoded เพราะ Next จับคู่ rewrite กับ path
    // ที่ยัง encode อยู่ ไม่ใช่ path ที่ decode แล้ว — ใส่เป็นภาษาไทยตรงๆ
    // จะไม่ match อะไรเลยและได้ 404 (ยืนยันด้วยการยิงจริงแล้ว)
    const root = "/%E0%B8%A3%E0%B8%AB%E0%B8%B1%E0%B8%AA%E0%B9%84%E0%B8%9B%E0%B8%A3%E0%B8%A9%E0%B8%93%E0%B8%B5%E0%B8%A2%E0%B9%8C";

    return [
      { source: root, destination: "/postcode" },
      { source: `${root}/:path*`, destination: "/postcode/:path*" },
    ];
  },

  images: {
    remotePatterns: [
      // รูปโปรไฟล์จากบัญชี Google — โดเมนเดียวที่ Google ใช้ส่งรูปผู้ใช้
      // ถ้าไม่ประกาศไว้ next/image จะโยน error ตอน render หน้าโปรไฟล์
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;

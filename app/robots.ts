import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site";

/**
 * robots.txt
 *
 * ปิดสองกลุ่มที่ไม่ควรถูก index:
 *   /api/     ไม่ใช่หน้าเว็บ และบางเส้นทางตอบ 503 โดยตั้งใจ (health check)
 *             ซึ่งถ้าถูก crawl จะกลายเป็นสัญญาณว่าเว็บพัง
 *   /admin/   หน้าหลังบ้าน ตอบ 404 ให้คนที่ไม่ใช่แอดมินอยู่แล้ว แต่ไม่มีเหตุผล
 *             ให้ crawler มาเสียเวลาเดินตรงนั้น
 *   /postcode ปลายทางจริงของหน้ารหัสไปรษณีย์ที่ rewrite ไปหา (ดู next.config.ts)
 *             ผู้ใช้และ crawler เห็นแต่ URL ภาษาไทยเสมอ การปิดตรงนี้กันไว้เผื่อ
 *             มีคนไปลิงก์ path อังกฤษเข้ามาตรงๆ แล้วกลายเป็นหน้าซ้ำสองชุด
 *
 * ⚠️ robots.txt ไม่ใช่กลไกความปลอดภัย — มันแค่บอกบ็อตที่ทำตามกติกา
 * การป้องกันจริงของ /admin คือ requireAdmin() ที่ตรวจทุกครั้งฝั่งเซิร์ฟเวอร์
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin/", "/postcode"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}

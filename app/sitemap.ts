import type { MetadataRoute } from "next";

import { CARRIER_LANDINGS } from "@/lib/carriers/landing";
import { PROVINCES } from "@/lib/postcodes";
import { absoluteUrl } from "@/lib/site";

/**
 * sitemap.xml — รวมทุกหน้าที่อยากให้ค้นเจอ
 *
 * ⚠️ URL ทุกอันผ่าน absoluteUrl() ซึ่ง encode ส่วนที่เป็นภาษาไทยให้แล้ว
 * (ดู lib/site.ts) — slug ของเราเป็นภาษาไทย ถ้าใส่ดิบๆ ไฟล์จะไม่ผ่านการตรวจ
 * ของ Google ที่บังคับว่า URL ใน sitemap ต้องเป็น ASCII ที่ escape แล้ว
 *
 * ตั้งใจไม่ใส่หน้าที่ต้องล็อกอิน (/history, /profile) และหน้าหลังบ้าน —
 * มันไม่มีเนื้อหาให้คนที่มาจาก Google และ /admin ก็ตอบ 404 ให้คนทั่วไปอยู่แล้ว
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: absoluteUrl("/"),
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    ...CARRIER_LANDINGS.map((carrier) => ({
      url: absoluteUrl(`/${carrier.slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    {
      url: absoluteUrl("/รหัสไปรษณีย์"),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    },
    // รหัสไปรษณีย์แทบไม่เปลี่ยน จึงบอก monthly และให้ priority ต่ำกว่าหน้าค้นพัสดุ
    // — มันเป็นเนื้อหาที่ดึงคนเข้ามา ไม่ใช่สิ่งที่เว็บนี้ทำได้ดีที่สุด
    ...PROVINCES.map((province) => ({
      url: absoluteUrl(`/รหัสไปรษณีย์/${province.name}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...PROVINCES.flatMap((province) =>
      province.amphoes.map((amphoe) => ({
        url: absoluteUrl(`/รหัสไปรษณีย์/${province.name}/${amphoe.name}`),
        lastModified: now,
        changeFrequency: "monthly" as const,
        priority: 0.5,
      })),
    ),
  ];
}

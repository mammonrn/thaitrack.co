/**
 * ตัวช่วยตอนรันเทสต์เท่านั้น — ไม่เกี่ยวกับโค้ดที่ deploy จริง
 *
 * โค้ดในโปรเจกต์ import แบบไม่ใส่นามสกุล (`from "../cache"`) ซึ่งถูกต้องสำหรับ
 * Next ที่ใช้ moduleResolution แบบ bundler แต่ Node ตอนรัน ESM ตรงๆ ต้องการ
 * เส้นทางเต็มพร้อมนามสกุล hook นี้เติมนามสกุลให้เวลาหาไฟล์ไม่เจอ จะได้ไม่ต้อง
 * แก้ import ทั้งโปรเจกต์เพียงเพื่อให้เทสต์รันได้
 */

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") || context.parentURL === undefined) {
        throw error;
      }

      for (const suffix of [".ts", ".tsx", "/index.ts"]) {
        const candidate = new URL(specifier + suffix, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) {
          // ไม่ระบุ format เอง ปล่อยให้ Node ตรวจว่าเป็น .ts แล้วถอด type ออกให้
          return { url: candidate.href, shortCircuit: true };
        }
      }

      throw error;
    }
  },
});

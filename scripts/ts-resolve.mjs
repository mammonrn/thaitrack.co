/**
 * ตัวช่วยตอนรันเทสต์เท่านั้น — ไม่เกี่ยวกับโค้ดที่ deploy จริง
 *
 * โค้ดในโปรเจกต์ import แบบไม่ใส่นามสกุล (`from "../cache"`) ซึ่งถูกต้องสำหรับ
 * Next ที่ใช้ moduleResolution แบบ bundler แต่ Node ตอนรัน ESM ตรงๆ ต้องการ
 * เส้นทางเต็มพร้อมนามสกุล hook นี้เติมนามสกุลให้เวลาหาไฟล์ไม่เจอ จะได้ไม่ต้อง
 * แก้ import ทั้งโปรเจกต์เพียงเพื่อให้เทสต์รันได้
 *
 * และแปลง alias "@/..." (ซึ่งตั้งไว้ใน tsconfig ให้ชี้ที่รากโปรเจกต์) ให้เป็น
 * เส้นทางจริง เพราะ Node ไม่รู้จัก paths ของ TypeScript
 */

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/** รากของโปรเจกต์ — ไฟล์นี้อยู่ใน scripts/ จึงถอยขึ้นไปหนึ่งชั้น */
const ROOT = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    // "@/lib/x" → เส้นทางจริงจากรากโปรเจกต์ ก่อนส่งต่อให้ตรรกะเดิม
    if (specifier.startsWith("@/")) {
      const target = new URL(specifier.slice(2), ROOT);
      if (existsSync(fileURLToPath(target))) {
        return { url: target.href, shortCircuit: true };
      }

      for (const suffix of [".ts", ".tsx", "/index.ts"]) {
        const candidate = pathToFileURL(fileURLToPath(target) + suffix);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }

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

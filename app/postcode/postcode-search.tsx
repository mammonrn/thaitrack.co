"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * ค้นย้อนกลับ: กรอกรหัสไปรษณีย์แล้วบอกว่าเป็นพื้นที่ไหน
 *
 * ------------------------------------------------------------------
 * โหลดตารางค้นหาเมื่อผู้ใช้เริ่มพิมพ์เท่านั้น ไม่ใช่ตอนเปิดหน้า
 *
 * ตารางมีขนาด ~77KB ซึ่งไม่คุ้มที่จะส่งให้ทุกคนที่เปิดหน้านี้ เพราะคนส่วนใหญ่
 * มาจาก Google ด้วยคำค้นแบบ "รหัสไปรษณีย์เชียงราย" แล้วกดเข้าหน้าจังหวัดไปเลย
 * ไม่ได้ใช้ช่องนี้ · ไฟล์อยู่ใน /public จึงถูก cache โดย CDN และโหลดครั้งเดียว
 * ------------------------------------------------------------------
 */
type Lookup = Record<string, [string, string][]>;

export default function PostcodeSearch() {
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (lookup !== null || loading) return;
    setLoading(true);

    try {
      const response = await fetch("/postcode-lookup.json");
      setLookup((await response.json()) as Lookup);
    } catch {
      // โหลดไม่ได้ = ช่องค้นย้อนกลับใช้ไม่ได้ แต่รายชื่อจังหวัดข้างล่างยังอยู่ครบ
      // ซึ่งเป็นทางหลักของหน้านี้อยู่แล้ว
    } finally {
      setLoading(false);
    }
  }

  const digits = code.replace(/\D/g, "").slice(0, 5);
  const matches = digits.length === 5 ? (lookup?.[digits] ?? []) : [];
  const searched = digits.length === 5 && lookup !== null;

  return (
    <div className="mt-6">
      <label
        htmlFor="postcode"
        className="block text-sm font-medium text-ink"
      >
        รู้รหัสอยู่แล้ว อยากรู้ว่าเป็นที่ไหน
      </label>

      <input
        id="postcode"
        type="text"
        inputMode="numeric"
        /*
          ปิด autofill โดยตั้งใจ: ช่องนี้ใช้ "ค้นหา" รหัส ไม่ใช่ "กรอกที่อยู่ของตัวเอง"
          รายการที่เบราว์เซอร์เสนอจะลอยทับผลลัพธ์ที่อยู่ถัดลงไปเพียง 10px พอดี
          ซึ่งบังสิ่งเดียวที่ผู้ใช้มาดู
        */
        autoComplete="off"
        maxLength={5}
        value={code}
        onChange={(event) => {
          setCode(event.target.value);
          void load();
        }}
        placeholder="เช่น 57100"
        className="mt-2 h-12 w-full max-w-[12rem] rounded-xl border border-line-strong bg-white px-4 text-center font-mono text-base text-body outline-none transition-colors placeholder:text-faint/70 hover:border-ink/30 focus:border-ink"
      />

      {searched && (
        <div className="mt-3 text-sm" aria-live="polite">
          {matches.length === 0 ? (
            <p className="text-faint">ไม่พบพื้นที่ที่ใช้รหัส {digits}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {matches.map(([province, amphoe]) => (
                <li key={`${province}/${amphoe}`}>
                  <Link
                    href={`/รหัสไปรษณีย์/${province}/${amphoe}`}
                    // พื้นที่กด 44px ตามเกณฑ์นิ้วสัมผัส — ผลลัพธ์คือสิ่งที่ผู้ใช้
                    // ตั้งใจกดต่อ ไม่ใช่ลิงก์ประกอบในเนื้อความ
                    className="inline-flex min-h-11 items-center text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                  >
                    อำเภอ{amphoe} จังหวัด{province}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

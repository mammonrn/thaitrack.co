"use client";

import { useEffect } from "react";

import { classifyChannel } from "@/lib/referrer-channel";

/**
 * บอกเซิร์ฟเวอร์ว่าเข้าเว็บมาจากช่องทางไหน — ครั้งเดียวต่อเซสชัน
 *
 * ------------------------------------------------------------------
 * ⚠️ สิ่งที่ส่งออกไปมีอย่างเดียวคือคำเดียวจากชุดปิด เช่น "google"
 * ไม่มี URL ต้นทาง ไม่มี user agent ไม่มีอะไรที่ระบุตัวคนได้
 * (ดูเหตุผลเต็มที่ lib/referrer-channel.ts)
 *
 * ครั้งเดียวต่อเซสชันเพราะคำถามคือ "คนมาจากไหน" ไม่ใช่ "เปิดกี่หน้า" ถ้านับ
 * ทุกหน้า ตัวเลขจะกลายเป็นการวัดว่าใครกดเยอะ ซึ่งตอบคำถามคนละข้อ
 * ------------------------------------------------------------------
 */
const SENT_KEY = "thaitrack.referrer.sent";

export default function ReferrerProbe() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SENT_KEY) === "1") return;
      sessionStorage.setItem(SENT_KEY, "1");
    } catch {
      // Safari โหมดส่วนตัวโยน error ตอนเขียน — ยอมนับซ้ำดีกว่าทำหน้าเว็บพัง
    }

    const utmSource =
      new URLSearchParams(window.location.search).get("utm_source") ?? "";

    const channel = classifyChannel(
      document.referrer,
      utmSource,
      window.location.hostname,
    );

    // null = เดินมาจากหน้าอื่นในเว็บเราเอง ไม่ใช่การเข้าชมใหม่
    if (channel === null) return;

    void fetch("/api/referrer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  return null;
}

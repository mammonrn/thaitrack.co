"use client";

/**
 * ปุ่มดาวน์โหลดรายงานสถิติ
 *
 * ------------------------------------------------------------------
 * ไฟล์ถูกสร้างในเบราว์เซอร์ตอนกด ไม่เก็บไว้ที่ไหนเลย
 *
 * ข้อมูลทั้งก้อนถูกส่งมาเป็น props พร้อมหน้าอยู่แล้ว (ดู ReportData ใน
 * lib/admin-report.ts) การกดปุ่มจึงไม่ยิง request ใหม่ ไม่แตะฐานข้อมูล และไม่
 * สร้างไฟล์ค้างไว้บนเซิร์ฟเวอร์ให้ต้องคอยลบ
 *
 * ผลพลอยได้ที่สำคัญกว่า: ตัวเลขในไฟล์ **ตรงกับที่ตาเห็นบนหน้าจอเป๊ะๆ** ไม่ใช่
 * ตัวเลขของอีกวินาทีหนึ่งที่ query ใหม่แล้วได้ไม่เท่าเดิม
 * ------------------------------------------------------------------
 *
 * ⚠️ ข้อมูลในรายงานเป็นตัวเลขรวมล้วน ไม่มีอะไรที่ระบุตัวบุคคลได้ (ข้อบังคับ
 * เดียวกับหน้านี้ทั้งหน้า) ถ้าวันหนึ่งมีคนอยากเพิ่มฟิลด์ ต้องผ่านข้อบังคับนั้น
 * ก่อนเสมอ — ไฟล์ที่ดาวน์โหลดไปแล้วเดินทางต่อไปที่ไหนก็ได้
 */

import { useState } from "react";

import {
  reportFileName,
  toJson,
  toMarkdown,
  type ReportData,
} from "@/lib/admin-report";

interface ExportButtonProps {
  data: ReportData;
}

type Format = "json" | "md";

const MIME: Record<Format, string> = {
  json: "application/json;charset=utf-8",
  md: "text/markdown;charset=utf-8",
};

export default function ExportButton({ data }: ExportButtonProps) {
  const [done, setDone] = useState<Format | null>(null);

  function download(format: Format) {
    const text = format === "json" ? toJson(data) : toMarkdown(data);
    const blob = new Blob([text], { type: MIME[format] });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = reportFileName(data.generatedAt, format);
    link.click();

    // คืนหน่วยความจำของ blob — ถ้าไม่ revoke มันค้างจนกว่าจะปิดแท็บ
    URL.revokeObjectURL(url);

    setDone(format);
    window.setTimeout(() => setDone(null), 2_000);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => download("json")}
        className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-white px-3 text-xs font-semibold text-ink transition-colors hover:bg-ink/5"
      >
        {done === "json" ? "ดาวน์โหลดแล้ว" : "JSON"}
      </button>
      <button
        type="button"
        onClick={() => download("md")}
        className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-white px-3 text-xs font-semibold text-ink transition-colors hover:bg-ink/5"
      >
        {done === "md" ? "ดาวน์โหลดแล้ว" : "Markdown"}
      </button>
    </div>
  );
}

"use client";

/**
 * สวิตช์เปิด/ปิดฟีเจอร์บนหน้าแอดมิน
 *
 * ⚠️ การซ่อนหรือแสดงปุ่มตรงนี้ **ไม่ใช่การป้องกัน** ด่านจริงอยู่ที่
 * app/api/admin/settings/route.ts ซึ่งตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ทุกครั้ง
 * component นี้เป็นแค่หน้าตา
 */

import { useState } from "react";

import {
  SETTING_LABEL,
  type SettingKey,
  type SettingValues,
} from "@/lib/app-settings";

interface SettingsToggleProps {
  settings: SettingValues;
}

type Status = "idle" | "saving" | "error";

export default function SettingsToggle({ settings }: SettingsToggleProps) {
  const [values, setValues] = useState<SettingValues>(settings);
  const [status, setStatus] = useState<Status>("idle");
  const [pendingKey, setPendingKey] = useState<SettingKey | null>(null);

  async function toggle(key: SettingKey) {
    const next = !values[key];

    setStatus("saving");
    setPendingKey(key);

    // แสดงผลทันทีก่อนรอเซิร์ฟเวอร์ตอบ แล้วย้อนกลับถ้าล้มเหลว — สวิตช์ที่
    // ค้างนิ่งหลังกดทำให้คนกดซ้ำ ซึ่งกลายเป็นการสลับไปกลับโดยไม่ตั้งใจ
    setValues((previous) => ({ ...previous, [key]: next }));

    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: next }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus("idle");
    } catch {
      // ย้อนกลับให้ตรงกับของจริงบนเซิร์ฟเวอร์ ไม่ปล่อยให้หน้าจอโกหก
      setValues((previous) => ({ ...previous, [key]: !next }));
      setStatus("error");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {(Object.keys(values) as SettingKey[]).map((key) => {
        const label = SETTING_LABEL[key];
        const on = values[key];
        const busy = pendingKey === key;

        return (
          <div
            key={key}
            className="flex items-start justify-between gap-4 rounded-xl border border-line bg-white/60 p-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{label.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-faint">
                {label.detail}
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={label.title}
              disabled={busy}
              onClick={() => void toggle(key)}
              className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
                on ? "bg-ok" : "bg-line-strong"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                  on ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>
        );
      })}

      {status === "error" && (
        <p role="alert" className="text-xs text-seal">
          บันทึกไม่สำเร็จ ค่ายังเป็นเหมือนเดิม ลองกดอีกครั้ง
        </p>
      )}
      {status === "saving" && (
        <p className="text-xs text-faint">กำลังบันทึก…</p>
      )}
    </div>
  );
}

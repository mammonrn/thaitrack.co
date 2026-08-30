"use client";

import { useEffect } from "react";

/**
 * ลงทะเบียน service worker
 *
 * แยกเป็น component ที่ไม่แสดงผลอะไร แล้วแขวนไว้ที่ layout กลาง เพื่อให้ทำงาน
 * ทุกหน้า ไม่ใช่เฉพาะหน้าที่มีปุ่มติดตั้ง
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      // ลงทะเบียนไม่สำเร็จแปลว่าติดตั้งเป็นแอพไม่ได้ แต่เว็บยังใช้งานได้ปกติ
      // จึงแค่บันทึกไว้ ไม่ต้องรบกวนผู้ใช้
      console.error("[pwa] ลงทะเบียน service worker ไม่สำเร็จ:", error);
    });
  }, []);

  return null;
}

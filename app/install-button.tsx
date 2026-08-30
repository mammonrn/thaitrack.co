"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import InstallGuideDialog from "./install-guide-dialog";

/**
 * event ที่ Chrome ยิงเมื่อเว็บเข้าเกณฑ์ติดตั้งเป็นแอพได้
 * ยังไม่อยู่ใน TypeScript DOM lib มาตรฐาน จึงประกาศเองเท่าที่ใช้
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const BUTTON_CLASS =
  "rounded-lg px-3 py-2 text-sm font-medium text-faint transition-colors hover:bg-ink/5 hover:text-ink";

/** subscribe แบบไม่ทำอะไร ใช้กับค่าที่อ่านครั้งเดียวแล้วไม่เปลี่ยนอีก */
const noopSubscribe = () => () => {};

/**
 * ติดตั้งไปแล้วหรือยัง
 *
 * ใช้ useSyncExternalStore เพราะเป็นการอ่านสถานะจากเบราว์เซอร์ซึ่งฝั่ง server
 * ไม่รู้ค่า การอ่านผ่าน hook นี้ทำให้ React จัดการความต่างระหว่าง server กับ
 * client ให้เอง ไม่ต้อง setState ใน effect ที่ทำให้เกิด render ซ้อน
 */
function useIsInstalled(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(display-mode: standalone)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      // Safari บน iOS ไม่รองรับ display-mode ใน matchMedia จึงต้องดูค่านี้ด้วย
      ("standalone" in navigator && navigator.standalone === true),
    () => false,
  );
}

/** iOS ไม่มี beforeinstallprompt ต้องบอกวิธีติดตั้งด้วยมือแทน */
function useIsIos(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => /iphone|ipad|ipod/i.test(navigator.userAgent),
    () => false,
  );
}

/**
 * ปุ่มติดตั้งแอพลงเครื่อง
 *
 * ซ่อนตัวเองเมื่อไม่มีทางติดตั้งได้จริง (ติดตั้งไปแล้ว หรือเบราว์เซอร์ไม่รองรับ
 * ทั้งสองทาง) ดีกว่าโชว์ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น
 */
export default function InstallButton() {
  const isInstalled = useIsInstalled();
  const isIos = useIsIos();
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  useEffect(() => {
    function capture(event: Event) {
      // กันไม่ให้ Chrome ขึ้นแถบเชิญติดตั้งของตัวเอง เรามีปุ่มของเราแล้ว
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    }

    function clearAfterInstall() {
      setPromptEvent(null);
      setIsGuideOpen(false);
    }

    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", clearAfterInstall);

    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", clearAfterInstall);
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (promptEvent === null) {
      setIsGuideOpen(true);
      return;
    }

    try {
      await promptEvent.prompt();
      // ใช้ได้ครั้งเดียวต่อหนึ่ง event ทิ้งไปเลยไม่ว่าผู้ใช้จะกดตกลงหรือไม่
      setPromptEvent(null);
    } catch (error) {
      console.error("[pwa] เรียกหน้าต่างติดตั้งไม่สำเร็จ:", error);
    }
  }, [promptEvent]);

  // ติดตั้งแล้ว หรือไม่มีทางติดตั้งได้เลย → ไม่ต้องมีปุ่ม
  if (isInstalled) return null;
  if (promptEvent === null && !isIos) return null;

  return (
    <>
      <button type="button" onClick={handleClick} className={BUTTON_CLASS}>
        ดาวน์โหลด
      </button>

      <InstallGuideDialog
        open={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />
    </>
  );
}

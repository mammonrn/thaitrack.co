"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  CAPTURED_PROMPT_KEY,
  PROMPT_CAPTURED_EVENT,
} from "./install-prompt-capture";
import { detectPlatform } from "./platform";

/**
 * event ที่ Chrome ยิงเมื่อเว็บเข้าเกณฑ์ติดตั้งเป็นแอพได้
 * ยังไม่อยู่ใน TypeScript DOM lib มาตรฐาน จึงประกาศเองเท่าที่ใช้
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  /** ยังรอดูว่าเบราว์เซอร์จะเสนอหน้าต่างติดตั้งให้หรือไม่ */
  | "checking"
  /** เปิดอยู่ในโหมดแอพแล้ว ไม่ต้องติดตั้งซ้ำ */
  | "installed"
  /** เรียกหน้าต่างติดตั้งของเบราว์เซอร์ได้เลย */
  | "promptable"
  /** ติดตั้งได้แต่ต้องกดเอง (Safari บน iOS) */
  | "manual"
  /** เบราว์เซอร์นี้ติดตั้งไม่ได้ */
  | "unsupported";

export interface InstallControl {
  state: InstallState;
  /** เรียกหน้าต่างติดตั้งของเบราว์เซอร์ — คืน false เมื่อไม่มีให้เรียก */
  install: () => Promise<boolean>;
  isGuideOpen: boolean;
  openGuide: () => void;
  closeGuide: () => void;
}

/** subscribe แบบไม่ทำอะไร ใช้กับค่าที่อ่านครั้งเดียวแล้วไม่เปลี่ยนอีก */
const noopSubscribe = () => () => {};

/**
 * รอ beforeinstallprompt นานแค่ไหนก่อนสรุปว่าเบราว์เซอร์นี้ติดตั้งไม่ได้
 *
 * Chrome ยิง event นี้หลังโหลดหน้าเสร็จไม่นาน ถ้าไม่รอเลย การ์ดติดตั้งจะขึ้นว่า
 * "ติดตั้งไม่ได้" แวบหนึ่งแล้วค่อยเปลี่ยนเป็นปุ่ม ซึ่งอ่านแล้วสับสน
 */
const SETTLE_MS = 1200;

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
 * สถานะการติดตั้งเป็นแอพ ใช้ร่วมกันทุกที่ที่ชวนติดตั้ง
 *
 * รวมไว้ที่เดียวเพราะปุ่มบนหัวเว็บกับการ์ดในหน้าโปรไฟล์ต้องเห็นสถานะตรงกันเสมอ
 * ถ้าแยกกันอ่าน event เอง จะมีจังหวะที่อันหนึ่งรู้ว่าติดตั้งได้แล้วอีกอันยังไม่รู้
 */
/**
 * บอกเซิร์ฟเวอร์ว่ามีการติดตั้งเพิ่มหนึ่งครั้ง — ล้มเหลวได้เงียบๆ
 *
 * `appinstalled` ยิงครั้งเดียวต่อการติดตั้งหนึ่งครั้ง จึงเป็นสัญญาณเดียวที่นับ
 * จำนวนการติดตั้งได้จริง ต่างจากการเช็ค display-mode ตอนเปิดหน้าซึ่งจะนับซ้ำ
 * ทุกครั้งที่เปิดแอพ
 *
 * ⚠️ ส่งแค่ platform กว้างๆ ไม่ส่ง user agent เต็มและไม่ส่งอะไรที่ระบุตัวคนได้
 * — จำนวนการติดตั้งเป็นตัวเลขรวม ไม่ใช่ข้อมูลของใครคนหนึ่ง
 *
 * ใช้ keepalive เพราะการติดตั้งมักตามด้วยการที่เบราว์เซอร์สลับไปเปิดแอพทันที
 * ซึ่งอาจฆ่า request ปกติทิ้งกลางทาง
 */
function reportInstall(): Promise<void> {
  return fetch("/api/installed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: detectPlatform() }),
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
}

export function useInstallState(): InstallControl {
  const isInstalled = useIsInstalled();
  const isIos = useIsIos();
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [hasSettled, setHasSettled] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  useEffect(() => {
    function capture(event: Event) {
      // กันไม่ให้ Chrome ขึ้นแถบเชิญติดตั้งของตัวเอง เรามีปุ่มของเราแล้ว
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    }

    /** หยิบ event ที่สคริปต์ใน <head> ดักไว้ให้ตั้งแต่ก่อน React ตื่น */
    function takeCaptured() {
      const captured = (window as unknown as Record<string, unknown>)[
        CAPTURED_PROMPT_KEY
      ];
      if (captured != null) {
        setPromptEvent(captured as BeforeInstallPromptEvent);
      }
    }

    function clearAfterInstall() {
      setPromptEvent(null);
      setIsGuideOpen(false);
      void reportInstall();
    }

    // ⚠️ ต้องอ่านของที่ดักไว้ก่อนเป็นอย่างแรก · effect นี้ทำงานช้ากว่าที่ Chrome
    // ยิง event ได้ถึง 340–480 ms ซึ่งพอสำหรับการเข้าเว็บครั้งที่สองเป็นต้นไป
    // (service worker ลงแล้ว) ที่ event มาถึงก่อน React hydrate เสร็จ
    // ดูรายละเอียดและวิธีวัดที่ lib/install-prompt-capture.ts
    takeCaptured();

    // ยังฟัง event ตรงๆ ต่อไปด้วย เผื่อ Chrome ยิงหลังจากนี้ (เข้าเว็บครั้งแรก)
    // และเพื่อให้ hook นี้ทำงานได้เองแม้ในหน้าที่ไม่มีสคริปต์ดัก เช่นในเทสต์
    window.addEventListener(PROMPT_CAPTURED_EVENT, takeCaptured);
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", clearAfterInstall);

    const timer = window.setTimeout(() => setHasSettled(true), SETTLE_MS);

    return () => {
      window.removeEventListener(PROMPT_CAPTURED_EVENT, takeCaptured);
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", clearAfterInstall);
      window.clearTimeout(timer);
    };
  }, []);

  const install = useCallback(async () => {
    if (promptEvent === null) return false;

    try {
      await promptEvent.prompt();
      // ใช้ได้ครั้งเดียวต่อหนึ่ง event ทิ้งไปเลยไม่ว่าผู้ใช้จะกดตกลงหรือไม่
      setPromptEvent(null);
      return true;
    } catch (error) {
      console.error("[pwa] เรียกหน้าต่างติดตั้งไม่สำเร็จ:", error);
      return false;
    }
  }, [promptEvent]);

  let state: InstallState;
  if (isInstalled) state = "installed";
  else if (promptEvent !== null) state = "promptable";
  else if (isIos) state = "manual";
  else state = hasSettled ? "unsupported" : "checking";

  return {
    state,
    install,
    isGuideOpen,
    openGuide: useCallback(() => setIsGuideOpen(true), []),
    closeGuide: useCallback(() => setIsGuideOpen(false), []),
  };
}

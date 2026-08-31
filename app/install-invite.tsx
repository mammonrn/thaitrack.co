"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  INVITE_DELAY_MS,
  INVITE_DETAIL,
  INVITE_EXIT_MS,
  INVITE_SPACE,
  INVITE_TITLE,
  NARROW_QUERY,
  SEARCH_SUCCESS_EVENT,
  hasCountedShown,
  hasSearchedThisSession,
  markShownCounted,
  rememberDismissal,
  reportInvite,
  shouldShowInvite,
  subscribeDismissal,
  wasDismissed,
} from "@/lib/install-invite";
import { useInstallState } from "@/lib/use-install-state";
import InstallGuideDialog from "./install-guide-dialog";

/** ซองจดหมายมีลูกศรลง — "เอาเว็บนี้ลงเครื่อง" ด้วยภาษาเส้นเดียวกับโลโก้ */
function DownloadMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="4.5" width="19" height="13" rx="2.5" />
      <path d="M3.2 5.4 L12 12.2 L20.8 5.4" />
      <path d="M12 15.5v5.5" />
      <path d="M9.4 18.6 L12 21.2 L14.6 18.6" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** จอแคบพอที่ปุ่มลอยจะมีที่ยืนหรือไม่ — อ่านจากเบราว์เซอร์ ไม่ใช่ซ่อนด้วย CSS */
function useIsNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(NARROW_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
    // ฝั่ง server ตอบว่าไม่แคบ = ไม่ render อะไรเลยใน HTML ชุดแรก
    // ซึ่งถูกต้องอยู่แล้วเพราะการ์ดนี้ต้องรอค้นหาสำเร็จก่อนเสมอ
    () => false,
  );
}

/** เคยกดปิดไปแล้วหรือยัง — ค่าอยู่ใน localStorage ซึ่งเป็นของเบราว์เซอร์ ไม่ใช่ของ React */
function useWasDismissed(): boolean {
  return useSyncExternalStore(subscribeDismissal, wasDismissed, () => false);
}

/** ค้นหาสำเร็จแล้วในเซสชันนี้หรือยัง — ฟังทั้งค่าที่เก็บไว้และ event สดๆ */
function useHasSearched(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(SEARCH_SUCCESS_EVENT, onChange);
      return () => window.removeEventListener(SEARCH_SUCCESS_EVENT, onChange);
    },
    hasSearchedThisSession,
    () => false,
  );
}

/**
 * ปุ่มลอยชวนติดตั้งแอป
 *
 * ------------------------------------------------------------------
 * อยู่ใน layout ไม่ใช่ในหน้าค้นหา เพราะเงื่อนไขคือ "ค้นสำเร็จแล้วในเซสชันนี้"
 * ไม่ใช่ "อยู่บนหน้าค้นหา" — คนที่ค้นเสร็จแล้วกดไปดูหน้าประวัติต่อ ยังเป็นคนที่
 * เพิ่งได้ประโยชน์จากเว็บอยู่ดี
 *
 * ใช้สถานะจาก useInstallState ตัวเดิมทั้งหมด ไม่ได้ตรวจ beforeinstallprompt เอง
 * ปุ่มบนหัวเว็บ การ์ดในหน้าโปรไฟล์ และปุ่มลอยจึงเห็นสถานะตรงกันเสมอ
 *
 * รูปทรงเป็นการ์ดมนแนวนอน ไม่ใช่วงกลมแบบ Shopee เพราะข้อความสั้นๆ ที่บอกว่า
 * "กดแล้วได้อะไร" ใส่ในวงกลมไม่ได้ และวงกลมที่มีแต่ไอคอนบังคับให้ผู้ใช้ต้องกด
 * เพื่อจะรู้ว่ามันคืออะไร ซึ่งเป็นการหลอกให้กดมากกว่าการชวน
 * ------------------------------------------------------------------
 */
export default function InstallInvite() {
  const { state, install, isGuideOpen, openGuide, closeGuide } =
    useInstallState();
  const narrow = useIsNarrow();
  const searched = useHasSearched();

  const dismissed = useWasDismissed();

  /** true เมื่อรอครบเวลาหน่วงแล้ว — ตั้งได้จากในนาฬิกาเท่านั้น ไม่มีใครสั่งกลับเป็น false */
  const [delayPassed, setDelayPassed] = useState(false);
  /** กดปุ่มติดตั้งไปแล้ว — คนละเรื่องกับกดปิด จึงไม่ได้จำข้ามเซสชัน */
  const [accepted, setAccepted] = useState(false);
  const [closing, setClosing] = useState(false);

  const eligible = shouldShowInvite({ state, searched, dismissed, narrow });

  // หน่วงก่อนโผล่ — ดูเหตุผลของตัวเลขที่ INVITE_DELAY_MS
  // เงื่อนไขหลุดระหว่างรอ (เช่นผู้ใช้หมุนจอจนกว้างขึ้น) นาฬิกาถูกยกเลิกไปด้วย
  useEffect(() => {
    if (!eligible || delayPassed) return;

    const timer = window.setTimeout(() => setDelayPassed(true), INVITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [eligible, delayPassed]);

  // คำนวณจากเงื่อนไข ไม่ใช่เก็บเป็น state คู่ขนาน — เงื่อนไขหลุดเมื่อไรก็หายเมื่อนั้น
  // โดยไม่ต้องมีใครคอยสั่งให้หาย ซึ่งเป็นจุดที่ state คู่ขนานมักหลุดจากกัน
  const visible = eligible && delayPassed && !accepted;

  // นับ "แสดง" ครั้งเดียวต่อเซสชัน — ถ้านับทุกครั้งที่ component ขึ้นใหม่
  // (เปลี่ยนหน้า, กด refresh) conversion rate จะต่ำกว่าความจริงโดยไม่มีเหตุผล
  const counted = useRef(false);
  useEffect(() => {
    if (!visible || counted.current) return;
    counted.current = true;

    if (hasCountedShown()) return;
    markShownCounted();
    void reportInvite("shown");
  }, [visible]);

  // เผื่อที่ให้เนื้อหาท้ายหน้าเลื่อนพ้นการ์ดนี้ — padding ล่างของ body อ่าน
  // ตัวแปรนี้อยู่ (ดู app/layout.tsx) ถ้าไม่เผื่อ บรรทัดสุดท้ายของไทม์ไลน์จะถูก
  // การ์ดบังจนอ่านไม่จบ ซึ่งแย่กว่าการไม่มีคำชวนเลย
  useEffect(() => {
    if (!visible && !closing) return;

    const root = document.documentElement;
    root.style.setProperty("--install-invite-space", INVITE_SPACE);
    return () => {
      root.style.removeProperty("--install-invite-space");
    };
  }, [visible, closing]);

  const close = useCallback(() => {
    setClosing(true);
    void reportInvite("dismissed");

    // จำว่าปิดแล้วหลังแอนิเมชันจบ ไม่ใช่ก่อน — ถ้าจำทันที เงื่อนไขจะหลุดแล้ว
    // การ์ดจะหายวับไปเลย ไม่ทันได้เลื่อนลง
    window.setTimeout(() => {
      rememberDismissal();
      setClosing(false);
    }, INVITE_EXIT_MS);
  }, []);

  const accept = useCallback(() => {
    void reportInvite("clicked");

    // กดแล้วต้องหายไม่ว่าปลายทางจะจบยังไง — ผู้ใช้แสดงเจตนาแล้ว การให้คำชวน
    // ค้างอยู่หลังจากนั้นคือการตื๊อ · แต่ไม่บันทึกว่า "ปิดถาวร" เพราะเขาไม่ได้ปฏิเสธ
    setAccepted(true);

    if (state === "promptable") void install();
    else openGuide();
  }, [install, openGuide, state]);

  // ⚠️ กล่องวิธีติดตั้ง (iOS) ต้อง render เสมอ ห้ามอยู่หลัง early return —
  // การกด "วิธีติดตั้ง" ทำให้การ์ดหายไปพร้อมกับเปิดกล่อง ถ้ากล่องอยู่ในกิ่งที่
  // ถูกตัดทิ้ง ผู้ใช้จะกดแล้วไม่มีอะไรเกิดขึ้นเลย
  const guide = <InstallGuideDialog open={isGuideOpen} onClose={closeGuide} />;

  if (!visible && !closing) return guide;

  return (
    <>
      <div
        className={`fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-4 pb-3 ${
          closing ? "animate-invite-out" : "animate-invite-in"
        }`}
      >
        <div
          role="complementary"
          aria-label="ชวนติดตั้งแอป"
          className="relative mx-auto w-full max-w-md rounded-2xl border border-line-strong bg-white px-3.5 py-2.5 shadow-float"
        >
          <div className="flex items-center gap-2.5">
            <DownloadMark className="h-5 w-5 shrink-0 text-ink" />

            <span className="min-w-0 flex-1 font-display text-sm font-semibold leading-tight text-ink">
              {INVITE_TITLE}
            </span>

            <button
              type="button"
              onClick={accept}
              className="h-10 shrink-0 rounded-xl bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-ink-strong"
            >
              {state === "manual" ? "วิธีติดตั้ง" : "ติดตั้ง"}
            </button>
          </div>

          {/* อยู่บรรทัดของตัวเองเต็มความกว้าง ไม่ใช่เบียดอยู่ข้างปุ่ม — ภาษาไทย
              ตัดบรรทัดกลางคำได้ ประโยคที่ถูกบีบให้แคบจึงขาดเป็น "ที่/อยู่"
              ซึ่งอ่านสะดุดกว่าการ์ดที่สูงขึ้นอีกหนึ่งบรรทัด */}
          <p className="mt-1 text-[13px] leading-snug text-faint">
            {INVITE_DETAIL}
          </p>

          {/* เกาะมุมการ์ดแทนที่จะกินความกว้างในแถว — พื้นที่กด 44×44 ตามเกณฑ์
              นิ้วสัมผัส ส่วนวงที่เห็นเล็กกว่านั้น เพื่อไม่ให้แย่งสายตาไปจากปุ่มติดตั้ง */}
          <button
            type="button"
            onClick={close}
            aria-label="ปิดคำชวนติดตั้งแอป"
            className="absolute -right-2.5 -top-2.5 flex h-11 w-11 items-center justify-center"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-white text-faint transition-colors hover:bg-paper hover:text-ink">
              <CloseIcon className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>
      </div>

      {guide}
    </>
  );
}

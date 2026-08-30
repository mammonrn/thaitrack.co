"use client";

/**
 * ปุ่มเข้าสู่ระบบ/ออกจากระบบที่มุมขวาของ header พร้อมกล่องยืนยันและ toast ทักทาย
 *
 * สถานะทั้งหมดมาจาก onAuthStateChange ของ Supabase ตัวเดียว — ไม่มีการยิงถามซ้ำ
 * เหตุการณ์ INITIAL_SESSION ที่ยิงมาทันทีตอน subscribe ทำหน้าที่บอกสถานะเริ่มต้น
 * ส่วน SIGNED_IN / SIGNED_OUT ทำให้ UI เปลี่ยนตามทันทีโดยไม่ต้อง reload
 *
 * ดีไซน์: อยู่ในโทนเดียวกับ header เดิม — ตัวอักษรสีจาง เข้มขึ้นตอน hover
 * ไม่มีสี ไม่มีไอคอนแบรนด์ เพราะ DESIGN.md กำหนดว่าตราประทับในการ์ดผลลัพธ์
 * ต้องเป็นจุดเดียวในหน้าที่กล้า — ตราประทับใน toast จึงเป็นแบบเล็กและนิ่งสนิท
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  avatarUrlOf,
  displayNameOf,
  initialOf,
  takeAuthFlags,
} from "@/lib/auth-view";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** สไตล์ร่วมของปุ่มข้อความใน header — เงียบ แล้วเข้มขึ้นตอน hover */
const HEADER_BUTTON_CLASS =
  "rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

/** toast อยู่นานพอให้อ่านชื่อจบ แต่ไม่นานจนต้องไล่ปิดเอง */
const TOAST_DURATION_MS = 4000;

type Phase =
  /** ยังไม่รู้ว่าล็อกอินอยู่หรือไม่ — กันไม่ให้ปุ่มกะพริบสลับสถานะตอนโหลด */
  | "loading"
  /** พร้อมใช้งาน (จะล็อกอินอยู่หรือไม่ ดูที่ user) */
  | "ready"
  /** ตั้งค่า Supabase ไม่ครบ — ปุ่มกดไปก็ไม่มีอะไรเกิดขึ้น จึงปิดไว้ */
  | "unavailable";

export function AuthButton() {
  /* สร้าง client ตอน mount ครั้งเดียว ไม่ทำใน useEffect เพราะกรณีตั้งค่าไม่ครบ
     จะต้อง setState ทันทีในตัว effect ซึ่งทำให้เกิด cascading render */
  const [supabase] = useState<SupabaseClient | null>(() => {
    try {
      return createSupabaseBrowserClient();
    } catch (cause) {
      console.error("[auth] สร้าง Supabase client ไม่สำเร็จ", cause);
      return null;
    }
  });

  const [phase, setPhase] = useState<Phase>(
    supabase ? "loading" : "unavailable",
  );
  const [user, setUser] = useState<User | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const [isConfirmingSignOut, setIsConfirmingSignOut] = useState(false);
  const [toastMessage, setToastMessage] = useState<ToastMessage | null>(null);

  /**
   * "เพิ่งกลับมาจาก /auth/callback ที่แลกสำเร็จ" — ตั้งใน effect แรก อ่านใน effect ที่สอง
   * (effect ทำงานตามลำดับที่ประกาศ จึงมั่นใจได้ว่าตั้งค่าก่อนถูกอ่าน)
   */
  const justSignedInRef = useRef(false);

  /** toast ที่รอแสดง — อ่านจาก URL ได้ก่อนที่ Supabase จะรายงานสถานะ session */
  const pendingToastRef = useRef<ToastMessage | null>(null);

  useEffect(() => {
    const { shouldGreet, errorMessage, cleanedUrl } = takeAuthFlags(
      window.location.href,
    );
    if (!shouldGreet && !errorMessage) return;

    // ตั้งอย่างเดียว ไม่เคยล้างเป็น false ตรงนี้ เพราะ StrictMode ใน dev
    // รัน effect ซ้ำรอบสอง ซึ่งตอนนั้น param ถูกถอดไปแล้วและจะได้ค่า false
    if (shouldGreet) justSignedInRef.current = true;

    // พักไว้ใน ref ก่อน แล้วให้ listener เป็นคนสั่งแสดง — setState ตรงๆ ในตัว effect
    // ทำให้เกิด cascading render (ESLint react-hooks/set-state-in-effect ก็ห้ามไว้)
    if (errorMessage) pendingToastRef.current = { tone: "error", text: errorMessage };

    // ถอด param ทิ้งทันที เพื่อให้ reload แล้ว toast ไม่โผล่ซ้ำ
    // (Next รองรับ history.replaceState โดยตรงและ sync กับ router ให้เอง)
    window.history.replaceState(null, "", cleanedUrl);
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;

      setUser(nextUser);
      setPhase("ready");
      // สถานะ auth ขยับแล้ว ความล้มเหลวของครั้งก่อนถือว่าหมดอายุ
      setHasFailed(false);

      if (nextUser && justSignedInRef.current) {
        justSignedInRef.current = false;
        setToastMessage({ tone: "welcome", name: displayNameOf(nextUser) });
      } else if (pendingToastRef.current) {
        setToastMessage(pendingToastRef.current);
        pendingToastRef.current = null;
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const handleSignIn = useCallback(async () => {
    if (!supabase || isBusy) return;

    setIsBusy(true);
    setHasFailed(false);

    // พากลับมาที่ /auth/callback ของเราเสมอ เพื่อให้ session ถูกเขียนลง cookie
    // ฝั่ง server ก่อนหน้าเว็บจะ render รอบถัดไป
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    // ถ้าสำเร็จ เบราว์เซอร์จะถูกพาออกไป Google แล้ว โค้ดใต้บรรทัดนี้จะไม่ได้ทำงาน
    if (error) {
      console.error("[auth] เริ่มการเข้าสู่ระบบด้วย Google ไม่สำเร็จ", error);
      setHasFailed(true);
      setIsBusy(false);
    }
  }, [supabase, isBusy]);

  const handleConfirmSignOut = useCallback(async () => {
    if (!supabase || isBusy) return;

    // ปิดกล่องก่อนเสมอ แล้วค่อยยิง signOut — ไม่ปล่อยให้ <dialog> ที่เปิดอยู่
    // ถูก unmount ไปพร้อมกับ UI ฝั่งล็อกอิน ซึ่งทิ้ง top layer ค้างไว้ได้
    setIsConfirmingSignOut(false);
    setIsBusy(true);

    const { error } = await supabase.auth.signOut();
    if (error) {
      /* auth-js ลบ session ในเครื่องทิ้งเสมอ ต่อให้ยิงบอกเซิร์ฟเวอร์ไม่สำเร็จ
         ผู้ใช้จึงออกจากระบบบนเครื่องนี้เรียบร้อยแล้วจริงๆ (SIGNED_OUT ยิงมาแล้ว)
         ที่ยังค้างคือ session บนอุปกรณ์อื่น — เป็นเรื่องที่ต้อง log ไว้ดู
         แต่ไม่ควรขึ้นว่า ไม่สำเร็จ ให้ผู้ใช้สับสน */
      console.error("[auth] แจ้งเซิร์ฟเวอร์ให้ยกเลิก session ไม่สำเร็จ", error);
    }

    setIsBusy(false);
  }, [supabase, isBusy]);

  const closeConfirm = useCallback(() => setIsConfirmingSignOut(false), []);
  const dismissToast = useCallback(() => setToastMessage(null), []);

  // toast อยู่นอกทุกสาขาด้านล่าง เพราะต้องอยู่ต่อได้แม้ปุ่มจะเปลี่ยนสถานะไปแล้ว
  const toast = toastMessage && (
    <AuthToast message={toastMessage} onDismiss={dismissToast} />
  );

  // ยังไม่รู้สถานะ — จองที่ไว้เท่าปุ่มจริง ไม่ให้ header ขยับตอนรู้ผล
  if (phase === "loading") {
    return <span className="block h-9 w-[5.5rem]" aria-hidden="true" />;
  }

  if (phase === "unavailable") {
    return (
      <span
        className={`${HEADER_BUTTON_CLASS} text-faint/60`}
        title="ระบบสมาชิกยังไม่พร้อมใช้งาน"
      >
        เข้าสู่ระบบ
      </span>
    );
  }

  if (!user) {
    return (
      <>
        <button
          type="button"
          onClick={handleSignIn}
          disabled={isBusy}
          className={`${HEADER_BUTTON_CLASS} ${
            hasFailed
              ? "text-seal hover:bg-seal/5"
              : "text-faint hover:bg-ink/5 hover:text-ink"
          }`}
        >
          {isBusy
            ? "กำลังพาไป Google…"
            : hasFailed
              ? "ไม่สำเร็จ · ลองอีกครั้ง"
              : "เข้าสู่ระบบ"}
        </button>
        {toast}
      </>
    );
  }

  const name = displayNameOf(user);
  const avatarUrl = avatarUrlOf(user);

  return (
    <>
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        <span className="flex min-w-0 items-center gap-2">
          {avatarUrl ? (
            /* รูปโปรไฟล์จาก Google เป็นภาพขนาด ~32px จากโดเมนภายนอกที่เปลี่ยนไปตามผู้ใช้
               การส่งผ่าน next/image จึงได้ไม่คุ้มเสีย และต้องไปผูก remotePatterns
               กับโดเมนของ Google เพิ่มโดยไม่จำเป็น */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              width={32}
              height={32}
              referrerPolicy="no-referrer"
              className="h-7 w-7 shrink-0 rounded-full border border-line object-cover sm:h-8 sm:w-8"
            />
          ) : (
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line bg-white font-display text-xs font-semibold text-ink sm:h-8 sm:w-8"
              aria-hidden="true"
            >
              {initialOf(name)}
            </span>
          )}
          {/* จอแคบซ่อนชื่อไว้เพื่อไม่ให้ header แน่น แต่ยังคงอยู่ให้ screen reader อ่าน */}
          <span className="max-w-[8rem] truncate text-sm font-medium text-ink max-sm:sr-only">
            {name}
          </span>
        </span>

        <button
          type="button"
          onClick={() => setIsConfirmingSignOut(true)}
          disabled={isBusy}
          className={`${HEADER_BUTTON_CLASS} px-2.5 text-faint hover:bg-ink/5 hover:text-ink sm:px-3`}
        >
          {isBusy ? "กำลังออก…" : "ออกจากระบบ"}
        </button>
      </div>

      {isConfirmingSignOut && (
        <SignOutDialog
          name={name}
          onConfirm={handleConfirmSignOut}
          onDismiss={closeConfirm}
        />
      )}

      {toast}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * กล่องยืนยันก่อนออกจากระบบ
 *
 * ใช้ <dialog> + showModal() ของเบราว์เซอร์แทนการประกอบ modal เอง เพราะได้
 * ของที่เขียนเองยากมาแบบฟรีๆ และถูกต้องตามสเปก:
 *   - focus trap จริง (ทุกอย่างนอก top layer ถูกทำเป็น inert)
 *   - ปุ่ม Escape ปิดกล่องให้เอง
 *   - คืนโฟกัสกลับไปที่ปุ่มที่กดเปิดตอนปิด
 *   - role="dialog" + aria-modal ติดมาให้แล้ว
 * เหลือแค่คลิกนอกกล่องที่ต้องดักเอง
 *
 * ต้อง portal ไปที่ body เพราะ header มี backdrop-blur ซึ่งทำให้ตัวมันเอง
 * กลายเป็น containing block ของลูกที่ position: fixed — ของลอยทุกชิ้น
 * ที่ render จากในนี้จะถูกขังอยู่ในกรอบ header ถ้าไม่ย้ายออกมา
 * ------------------------------------------------------------------ */

function SignOutDialog({
  name,
  onConfirm,
  onDismiss,
}: {
  name: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.showModal();
    // เริ่มที่ ยกเลิก — ปุ่มที่กดพลาดแล้วไม่เสียหาย
    cancelRef.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="sign-out-dialog-title"
      aria-describedby="sign-out-dialog-detail"
      /* ต้องดัก cancel ไม่ใช่ close
         cancel ยิงเฉพาะตอน "ผู้ใช้ขอปิด" (กด Escape) ส่วน close ยิงทุกครั้ง
         ที่กล่องปิด รวมถึง close() ที่ cleanup ของ effect เรียกเอง —
         ซึ่ง StrictMode ใน dev สั่งให้รันทันทีหลัง mount แล้วค่อย mount ใหม่
         ถ้าไปดัก close กล่องจะปิดตัวเองใน ~7ms ทุกครั้งที่เปิด */
      onCancel={onDismiss}
      // คลิกที่ตัว <dialog> เอง = คลิกโดน backdrop เพราะเนื้อหาทั้งหมด
      // อยู่ใน <div> ข้างใน และ dialog ตัวนอกไม่มี padding ให้คลิกโดน
      onClick={(event) => {
        if (event.target === dialogRef.current) onDismiss();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-line bg-white p-0 shadow-lift"
    >
      <div className="animate-rise p-5 sm:p-6">
        <h2
          id="sign-out-dialog-title"
          className="font-display text-lg font-semibold text-ink sm:text-xl"
        >
          ต้องการออกจากระบบใช่ไหม?
        </h2>
        <p
          id="sign-out-dialog-detail"
          className="mt-2 text-sm leading-relaxed text-faint"
        >
          คุณจะออกจากบัญชี {name} บนเครื่องนี้ เข้าสู่ระบบใหม่ได้ทุกเมื่อ
        </p>

        <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onDismiss}
            className="h-11 rounded-lg border border-line-strong px-5 font-display text-sm font-semibold text-ink transition-colors hover:bg-ink/5"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-11 rounded-lg bg-ink px-5 font-display text-sm font-semibold text-white transition-colors hover:bg-ink-strong"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

/* ------------------------------------------------------------------ *
 * Toast แจ้งผลการเข้าสู่ระบบ
 *
 * ทักทายเฉพาะตอน "เพิ่งล็อกอินเสร็จ" เท่านั้น (ดู takeAuthFlags ใน lib/auth-view.ts)
 * เปิดหน้าเว็บซ้ำทั้งที่ล็อกอินค้างอยู่จะไม่โผล่
 *
 * โทน error ใช้ภาษาภาพเดียวกับการ์ดแจ้งปัญหาในหน้าแรก — เส้นชาดด้านซ้าย
 * ไม่ใช่พื้นสีแดงทั้งใบ ตามที่ DESIGN.md กำหนดว่าสีชาดต้องใช้อย่างประหยัด
 * ------------------------------------------------------------------ */

type ToastMessage =
  | { tone: "welcome"; name: string }
  | { tone: "error"; text: string };

function AuthToast({
  message,
  onDismiss,
}: {
  message: ToastMessage;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const isError = message.tone === "error";

  return createPortal(
    <div
      // ข้อความผิดพลาดใช้ alert เพื่อให้ screen reader อ่านทันที
      // ส่วนคำทักทายใช้ status/polite จะได้ไม่ไปขัดสิ่งที่กำลังอ่านอยู่
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={`animate-rise fixed inset-x-4 bottom-4 z-50 flex items-center gap-3 rounded-xl border border-line bg-white p-3.5 shadow-lift sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-80 sm:p-4 ${
        isError ? "border-l-[3px] border-l-seal" : ""
      }`}
    >
      {!isError && <PostmarkMark className="h-9 w-9 shrink-0 text-seal" />}

      <p className="min-w-0 flex-1 text-sm leading-snug text-faint">
        {isError ? (
          message.text
        ) : (
          <>
            ยินดีต้อนรับ{" "}
            <span className="font-medium text-ink">{message.name}</span>
          </>
        )}
      </p>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="ปิดข้อความ"
        className="-mr-1 shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-ink/5 hover:text-ink"
      >
        <svg
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" />
        </svg>
      </button>
    </div>,
    document.body,
  );
}

/**
 * ตราประทับขนาดย่อ — motif เดียวกับตราประทับในการ์ดผลลัพธ์ แต่ตัดให้เหลือ
 * วงนอกเส้นประ วงใน และเส้นคลื่นเส้นเดียว ให้อ่านออกที่ขนาด 36px
 *
 * นิ่งสนิท ไม่มีแอนิเมชัน เพราะ DESIGN.md ให้สิทธิ์เคลื่อนไหวไว้กับ
 * ตราประทับในการ์ดผลลัพธ์ที่เดียว
 */
function PostmarkMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r="46" strokeWidth="5" strokeDasharray="5 6" />
      <circle cx="50" cy="50" r="34" strokeWidth="3" opacity="0.8" />
      <path d="M28 50 q7 -5 14 0 t14 0 t14 0" strokeWidth="3" opacity="0.55" />
    </svg>
  );
}

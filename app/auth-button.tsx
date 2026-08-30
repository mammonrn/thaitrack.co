"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";

import {
  authErrorFromCode,
  displayNameOf,
  signInWithGoogle,
  signOut,
  type AuthOutcome,
} from "@/lib/auth-view";
import { getBrowserClient } from "@/lib/supabase/client";
import type { UserFacingError } from "@/lib/tracking-view";

const BUTTON_CLASS =
  "rounded-lg px-3 py-2 text-sm font-medium text-faint transition-colors hover:bg-ink/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60";

/**
 * อ่านรหัสความผิดพลาดที่ /auth/callback ส่งกลับมาทาง query string แล้วล้างทิ้ง
 *
 * อ่านจาก window.location เองแทน useSearchParams เพื่อให้หน้าแรกยัง prerender
 * เป็น static ได้ (useSearchParams บังคับให้ต้องมี Suspense ครอบ)
 */
function takeCallbackError(): UserFacingError | null {
  const params = new URLSearchParams(window.location.search);
  const failure = authErrorFromCode(params.get("auth_error"));
  if (failure === null) return null;

  // ล้าง query ทิ้งเพื่อไม่ให้ error ค้างเมื่อผู้ใช้กด refresh
  params.delete("auth_error");
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query === "" ? "" : `?${query}`}`,
  );

  return failure;
}

/**
 * ปุ่มเข้าสู่ระบบ / ออกจากระบบ บนหัวเว็บ
 *
 * หน้าแรกถูก prerender เป็นไฟล์ static ตอน build ตอนนั้นจึงยังไม่รู้ว่าใครเป็น
 * ผู้ใช้ สถานะสมาชิกจึงต้องอ่านฝั่งเบราว์เซอร์หลัง mount เท่านั้น ระหว่างที่ยัง
 * ไม่รู้ผลจะแสดงปุ่มแบบกดไม่ได้ไว้ก่อน เพื่อไม่ให้หัวเว็บกระตุกตอนสถานะเปลี่ยน
 */
export default function AuthButton() {
  const [user, setUser] = useState<User | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);

  // กันไม่ให้ setState หลัง component ถูกถอดออกจากหน้าจอแล้ว
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    let subscription: { unsubscribe: () => void } | undefined;

    async function initialize() {
      const callbackError = takeCallbackError();

      let currentUser: User | null = null;

      try {
        const supabase = getBrowserClient();

        // เกาะติดการเปลี่ยนสถานะไว้ก่อน เพื่อให้หัวเว็บอัปเดตเองเมื่อ session
        // เปลี่ยน เช่น เพิ่งกลับมาจาก Google หรือออกจากระบบที่แท็บอื่น
        subscription = supabase.auth.onAuthStateChange((_event, session) => {
          if (!isActive) return;
          setUser(session?.user ?? null);
          setIsReady(true);
        }).data.subscription;

        const { data } = await supabase.auth.getUser();
        currentUser = data.user;
      } catch (cause) {
        // ตั้งค่า Supabase ไม่ครบ หรืออ่านสถานะไม่ได้ — ไม่ต้องรบกวนผู้ใช้ตอนนี้
        // ถือว่ายังไม่ล็อกอิน แล้วค่อยบอกเหตุผลตอนกดปุ่ม
        console.error("[auth] อ่านสถานะผู้ใช้ไม่สำเร็จ:", cause);
      }

      if (!isActive) return;

      setUser(currentUser);
      if (callbackError !== null) setError(callbackError);
      setIsReady(true);
    }

    void initialize();

    return () => {
      isActive = false;
      subscription?.unsubscribe();
    };
  }, []);

  const runAction = useCallback(async (action: () => Promise<AuthOutcome>) => {
    setIsWorking(true);
    setError(null);

    const outcome = await action();

    if (!isMountedRef.current) return;

    // เมื่อเข้าสู่ระบบสำเร็จ เบราว์เซอร์กำลังถูกพาไป Google อยู่ จึงคง isWorking
    // ไว้เพื่อไม่ให้กดซ้ำได้ระหว่างรอเปลี่ยนหน้า
    if (outcome.ok) return;

    setError(outcome.error);
    setIsWorking(false);
  }, []);

  const label = !isReady
    ? "กำลังตรวจสอบ"
    : user === null
      ? "เข้าสู่ระบบ"
      : "ออกจากระบบ";

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        {user !== null && (
          <span className="hidden max-w-[12rem] truncate text-sm text-faint sm:inline">
            {displayNameOf(user)}
          </span>
        )}

        <button
          type="button"
          onClick={() => runAction(user === null ? signInWithGoogle : signOut)}
          disabled={!isReady || isWorking}
          className={BUTTON_CLASS}
        >
          {isWorking ? "กำลังดำเนินการ" : label}
        </button>
      </div>

      {error !== null && (
        <div
          role="alert"
          className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-line-strong bg-white p-3 text-left shadow-lg"
        >
          <p className="text-sm font-semibold text-seal">{error.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-faint">
            {error.detail}
          </p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-2 text-sm font-medium text-ink underline underline-offset-2"
          >
            ปิด
          </button>
        </div>
      )}
    </div>
  );
}

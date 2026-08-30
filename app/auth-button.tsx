"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";

import {
  displayNameOf,
  signInWithGoogle,
  signOut,
  takeCallbackSignals,
  type AuthOutcome,
} from "@/lib/auth-view";
import { getBrowserClient } from "@/lib/supabase/client";
import type { UserFacingError } from "@/lib/tracking-view";
import LogoutDialog from "./logout-dialog";
import WelcomeToast from "./welcome-toast";

const BUTTON_CLASS =
  "rounded-lg px-3 py-2 text-sm font-medium text-faint transition-colors hover:bg-ink/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60";

/**
 * ปุ่มเข้าสู่ระบบ / ออกจากระบบ บนหัวเว็บ
 *
 * หน้าแรกถูก prerender เป็นไฟล์ static ตอน build ตอนนั้นจึงยังไม่รู้ว่าใครเป็น
 * ผู้ใช้ สถานะสมาชิกจึงต้องอ่านฝั่งเบราว์เซอร์หลัง mount เท่านั้น
 */
export default function AuthButton() {
  const [user, setUser] = useState<User | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false);
  /** ชื่อที่จะทักใน toast — null คือไม่ต้องโชว์ */
  const [welcomeName, setWelcomeName] = useState<string | null>(null);

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
      // ต้องอ่านและล้าง query ก่อนอย่างอื่น จะได้ไม่ค้างอยู่ใน URL ระหว่างรอเครือข่าย
      const signals = takeCallbackSignals();

      let currentUser: User | null = null;

      try {
        const supabase = getBrowserClient();

        // เกาะติดการเปลี่ยนสถานะไว้ก่อน เพื่อให้หัวเว็บอัปเดตเองเมื่อ session
        // เปลี่ยน เช่น เพิ่งกลับมาจาก Google หรือออกจากระบบที่แท็บอื่น
        subscription = supabase.auth.onAuthStateChange((_event, session) => {
          if (!isActive) return;
          setUser(session?.user ?? null);
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
      if (signals.error !== null) setError(signals.error);
      // อ่านชื่อไม่ได้ก็ยังทักได้ ดีกว่าเงียบทั้งที่เพิ่งล็อกอินสำเร็จ
      if (signals.welcomed) {
        setWelcomeName(currentUser === null ? "" : displayNameOf(currentUser));
      }
    }

    void initialize();

    return () => {
      isActive = false;
      subscription?.unsubscribe();
    };
  }, []);

  const runAction = useCallback(
    async (
      action: () => Promise<AuthOutcome>,
      { leavesPage = false }: { leavesPage?: boolean } = {},
    ) => {
      setIsWorking(true);
      setError(null);

      const outcome = await action();

      if (!isMountedRef.current) return;

      if (!outcome.ok) setError(outcome.error);

      // เข้าสู่ระบบสำเร็จ = เบราว์เซอร์กำลังถูกพาไปหน้า Google อยู่ ต้องคงปุ่มไว้
      // ไม่ให้กดซ้ำระหว่างรอเปลี่ยนหน้า
      //
      // ส่วนออกจากระบบสำเร็จ ผู้ใช้ยังอยู่หน้าเดิม ถ้าไม่คืนปุ่มตรงนี้จะค้างที่
      // "กำลังดำเนินการ" ตลอดไป จึงต้องแยกสองกรณีนี้ออกจากกันให้ชัด
      if (outcome.ok && leavesPage) return;

      setIsWorking(false);
    },
    [],
  );

  const handleSignOutConfirmed = useCallback(() => {
    setIsConfirmingLogout(false);
    setWelcomeName(null);
    void runAction(signOut);
  }, [runAction]);

  const dismissWelcome = useCallback(() => setWelcomeName(null), []);

  const displayName = user === null ? "" : displayNameOf(user);

  // ตั้งต้นเป็น "เข้าสู่ระบบ" เสมอ ไม่ใช่สถานะกำลังโหลด เพราะหน้านี้ถูก prerender
  // เป็น HTML static ตอน build ถ้าตั้งต้นเป็นปุ่มที่กดไม่ได้ HTML ที่ถูกส่งออกไป
  // (และที่ crawler กับ curl เห็น) จะเป็นปุ่มที่กดไม่ได้ตลอด และถ้า JS โหลดไม่สำเร็จ
  // ผู้ใช้จะเจอปุ่มค้างโดยไม่มีทางออก สถานะที่พบบ่อยที่สุดคือยังไม่ล็อกอินอยู่แล้ว
  const label = user === null ? "เข้าสู่ระบบ" : "ออกจากระบบ";

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        {user !== null && (
          <span className="hidden max-w-[12rem] truncate text-sm text-faint sm:inline">
            {displayName}
          </span>
        )}

        <button
          type="button"
          onClick={() => {
            if (user === null) {
              void runAction(signInWithGoogle, { leavesPage: true });
            } else {
              setIsConfirmingLogout(true);
            }
          }}
          disabled={isWorking}
          className={BUTTON_CLASS}
        >
          {isWorking ? "กำลังดำเนินการ" : label}
        </button>
      </div>

      <LogoutDialog
        open={isConfirmingLogout}
        userName={displayName}
        onConfirm={handleSignOutConfirmed}
        onCancel={() => setIsConfirmingLogout(false)}
      />

      {welcomeName !== null && (
        <WelcomeToast userName={welcomeName} onDismiss={dismissWelcome} />
      )}

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

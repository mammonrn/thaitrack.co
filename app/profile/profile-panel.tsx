"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import type { User } from "@supabase/supabase-js";

import { displayNameOf, signInWithGoogle, signOut } from "@/lib/auth-view";
import { getBrowserClient } from "@/lib/supabase/client";
import { readSupabaseEnv } from "@/lib/supabase/env";
import type { UserFacingError } from "@/lib/tracking-view";
import LogoutDialog from "../logout-dialog";

/** ขนาดรูปโปรไฟล์เป็นพิกเซล ใช้ทั้งกับ next/image และวงกลมตัวอักษรย่อ */
const AVATAR_SIZE = 56;

/** รูปโปรไฟล์จาก Google — ไม่มีก็ได้ ผู้ใช้บางคนไม่ได้ตั้งรูปไว้ */
function avatarUrlOf(user: User): string | null {
  const metadata = user.user_metadata as
    | { avatar_url?: unknown; picture?: unknown }
    | undefined;

  for (const value of [metadata?.avatar_url, metadata?.picture]) {
    if (typeof value === "string" && value.startsWith("https://")) return value;
  }

  return null;
}

/** ตัวอักษรแรกของชื่อ ใช้แทนรูปเมื่อไม่มีรูปหรือรูปโหลดไม่ขึ้น */
function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

/**
 * บัตรประจำตัวในหน้าโปรไฟล์
 *
 * อ่านสถานะฝั่งเบราว์เซอร์เหมือนปุ่มบนหัวเว็บ เพราะหน้านี้ไม่ได้ผูกกับ session
 * ตอน build และการอ่านจาก cookie ในเครื่องเร็วกว่ารอ server ตอบ
 */
export default function ProfilePanel() {
  // อ่านตอน render ได้เลย เพราะ Next แทนค่า NEXT_PUBLIC_* เป็นค่าคงที่ตอน build
  // ฟังก์ชันนี้จึงให้คำตอบเดียวกันทั้งฝั่ง server และ client ไม่ต้อง setState ใน
  // effect ซึ่งทำให้เกิด render ซ้อน
  const isConfigured = readSupabaseEnv().ok;

  const [user, setUser] = useState<User | null>(null);
  const [isResolved, setIsResolved] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);

  useEffect(() => {
    if (!isConfigured) return;

    let isActive = true;
    let subscription: { unsubscribe: () => void } | undefined;

    try {
      const supabase = getBrowserClient();
      // onAuthStateChange ยิง INITIAL_SESSION ให้ทันทีจาก cookie ในเครื่อง
      // จึงไม่ต้องเรียก getUser() แล้วรอเครือข่ายก่อนวาดหน้า
      subscription = supabase.auth.onAuthStateChange((_event, session) => {
        if (!isActive) return;
        setUser(session?.user ?? null);
        setIsResolved(true);
        setImageFailed(false);
      }).data.subscription;
    } catch (cause) {
      // ตั้งค่าครบแล้วแต่ยังสร้าง client ไม่ได้ ถือเป็นเรื่องผิดปกติจริงๆ
      // ปล่อยให้ค้างที่ "กำลังตรวจสอบ" แล้วบอกเหตุผลตอนกดปุ่มแทน
      console.error("[auth] อ่านสถานะผู้ใช้ไม่สำเร็จ:", cause);
    }

    return () => {
      isActive = false;
      subscription?.unsubscribe();
    };
  }, [isConfigured]);

  const handleSignIn = useCallback(async () => {
    setIsWorking(true);
    setError(null);

    const outcome = await signInWithGoogle();

    // สำเร็จ = เบราว์เซอร์กำลังถูกพาไปหน้า Google คงปุ่มปิดไว้ไม่ให้กดซ้ำ
    if (outcome.ok) return;

    setError(outcome.error);
    setIsWorking(false);
  }, []);

  const handleSignOutConfirmed = useCallback(async () => {
    setIsConfirmingLogout(false);
    setIsWorking(true);
    setError(null);

    const outcome = await signOut();

    if (!outcome.ok) setError(outcome.error);
    setIsWorking(false);
  }, []);

  const displayName = user === null ? "" : displayNameOf(user);
  const avatarUrl = user === null ? null : avatarUrlOf(user);

  return (
    <>
      <section className="mt-6 rounded-xl border border-line bg-white p-5">
        {!isConfigured && (
          <>
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">
              ระบบสมาชิกยังไม่พร้อมใช้งาน
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-faint">
              ไม่ใช่ความผิดของคุณ ทีมงานยังตั้งค่าระบบไม่เสร็จ
              ระหว่างนี้ยังค้นหาพัสดุได้ตามปกติโดยไม่ต้องเข้าสู่ระบบ
            </p>
          </>
        )}

        {isConfigured && !isResolved && (
          <p className="text-sm text-faint">กำลังตรวจสอบสถานะการเข้าสู่ระบบ</p>
        )}

        {isConfigured && isResolved && user === null && (
          <>
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">
              ยังไม่ได้เข้าสู่ระบบ
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-faint">
              เข้าสู่ระบบด้วยบัญชี Google เพื่อบันทึกพัสดุที่ค้นหาไว้ดูย้อนหลัง
              ค้นหาพัสดุยังทำได้ตามปกติแม้ไม่เข้าสู่ระบบ
            </p>
            <button
              type="button"
              onClick={() => void handleSignIn()}
              disabled={isWorking}
              className="mt-4 inline-flex h-11 items-center rounded-xl bg-ink px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isWorking ? "กำลังดำเนินการ" : "เข้าสู่ระบบด้วย Google"}
            </button>
          </>
        )}

        {isConfigured && isResolved && user !== null && (
          <>
            <div className="flex items-center gap-4">
              {avatarUrl !== null && !imageFailed ? (
                <Image
                  src={avatarUrl}
                  alt=""
                  width={AVATAR_SIZE}
                  height={AVATAR_SIZE}
                  // รูปจาก Google ล่มได้ (เปลี่ยนรูป, โดนบล็อก) ต้องมีทางถอย
                  onError={() => setImageFailed(true)}
                  className="h-14 w-14 shrink-0 rounded-full border border-line object-cover"
                />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-line-strong bg-paper font-display text-xl font-bold text-ink">
                  {initialOf(displayName)}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-lg font-bold tracking-tight text-ink">
                  {displayName}
                </p>
                {typeof user.email === "string" && user.email !== "" && (
                  <p className="mt-0.5 truncate text-sm text-faint">{user.email}</p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsConfirmingLogout(true)}
              disabled={isWorking}
              className="mt-5 inline-flex h-11 items-center rounded-xl border border-line-strong bg-white px-5 text-sm font-medium text-ink transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isWorking ? "กำลังดำเนินการ" : "ออกจากระบบ"}
            </button>
          </>
        )}

        {error !== null && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-line-strong bg-paper p-3"
          >
            <p className="text-sm font-semibold text-seal">{error.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-faint">
              {error.detail}
            </p>
          </div>
        )}
      </section>

      <LogoutDialog
        open={isConfirmingLogout}
        userName={displayName}
        onConfirm={() => void handleSignOutConfirmed()}
        onCancel={() => setIsConfirmingLogout(false)}
      />
    </>
  );
}

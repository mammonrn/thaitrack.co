"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { getBrowserClient } from "./supabase/client";

export interface SessionUserState {
  user: User | null;
  /** false ระหว่างที่ยังไม่รู้สถานะ ใช้กันไม่ให้ปุ่มกะพริบตอนโหลดหน้า */
  isResolved: boolean;
}

/**
 * สถานะผู้ใช้จาก cookie สำหรับตัดสินใจว่าจะโชว์ปุ่มไหน
 *
 * ใช้ onAuthStateChange อย่างเดียว ไม่เรียก getUser() เพราะ onAuthStateChange
 * ยิง INITIAL_SESSION ให้ทันทีจาก cookie ในเครื่อง ไม่ต้องรอเครือข่าย
 *
 * ความถูกต้องระดับความปลอดภัยไม่ได้พึ่งค่านี้ — ทุก endpoint ที่แตะข้อมูลจริง
 * ตรวจ getUser() ฝั่ง server เองอีกชั้น และ RLS ที่ฐานข้อมูลกันไว้เป็นด่านสุดท้าย
 * ค่านี้จึงใช้แค่ตัดสินใจว่าจะแสดงปุ่ม "บันทึกไว้" หรือไม่เท่านั้น
 */
export function useSessionUser(): SessionUserState {
  const [state, setState] = useState<SessionUserState>({
    user: null,
    isResolved: false,
  });

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | undefined;

    try {
      const supabase = getBrowserClient();
      subscription = supabase.auth.onAuthStateChange((_event, session) => {
        setState({ user: session?.user ?? null, isResolved: true });
      }).data.subscription;
    } catch (cause) {
      // ตั้งค่า Supabase ไม่ครบ = ไม่มีระบบสมาชิกให้ใช้อยู่แล้ว ปล่อยให้ isResolved
      // เป็น false ต่อไป ปุ่มที่ต้องล็อกอินจึงไม่โผล่ ซึ่งเป็นพฤติกรรมที่ถูกต้อง
      console.error("[auth] เริ่มต้น client ไม่สำเร็จ:", cause);
    }

    return () => subscription?.unsubscribe();
  }, []);

  return state;
}

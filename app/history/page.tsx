import Link from "next/link";
import type { Metadata } from "next";

import {
  SAVED_TRACKING_COLUMNS,
  sortBySavedAtDesc,
  summarizeSavedTrackings,
  toSavedTracking,
  type SavedTracking,
} from "@/lib/saved-trackings";
import { SupabaseConfigError } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import HistoryList from "./history-list";
import HistorySummary from "./history-summary";

export const metadata: Metadata = {
  title: "ประวัติที่บันทึกไว้ — พัสดุไทย.com",
  description: "รายการพัสดุที่คุณกดบันทึกไว้ พร้อมสถานะล่าสุดและตำแหน่ง",
};

/** อ่าน session จาก cookie จึงเป็นหน้าที่ต้อง render ตอนมี request เสมอ */
export const dynamic = "force-dynamic";

type PageState =
  | { kind: "unavailable" }
  | { kind: "guest" }
  | { kind: "ready"; items: SavedTracking[] };

async function loadHistory(): Promise<PageState> {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      console.error(`[history] ${error.message}`);
      return { kind: "unavailable" };
    }
    throw error;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) return { kind: "guest" };

  // ไม่ต้องใส่ where user_id เอง เพราะ RLS กรองให้เหลือเฉพาะแถวของเจ้าตัวอยู่แล้ว
  //
  // เรียงตาม created_at (เวลาที่กดบันทึก) ไม่ใช่ last_updated_at (เวลาที่ขนส่ง
  // ขยับสถานะ) เพราะของที่เพิ่งบันทึกแต่ยังไม่มีความเคลื่อนไหวควรอยู่บนสุด
  const { data, error } = await supabase
    .from("saved_trackings")
    .select(SAVED_TRACKING_COLUMNS)
    .order("created_at", { ascending: false });

  if (error !== null) {
    console.error(`[history] อ่านประวัติไม่สำเร็จ: ${error.message}`);
    return { kind: "ready", items: [] };
  }

  // เรียงซ้ำฝั่งแอปด้วย เพื่อให้ลำดับเป็นชุดเดียวกับที่ client ใช้ต่อรายการเพิ่ม
  return {
    kind: "ready",
    items: sortBySavedAtDesc((data ?? []).map(toSavedTracking)),
  };
}

/**
 * คีย์สำหรับ Google Maps Embed API
 *
 * แยกจาก GOOGLE_MAPS_API_KEY ที่ใช้ทำ geocode โดยตั้งใจ เพราะ Embed API ต้องใส่
 * คีย์ลงใน URL ของ iframe ซึ่งผู้ใช้เปิดดู source เห็นได้เสมอ ถ้าเอาคีย์ตัวเดียว
 * กับที่ใช้ฝั่ง server มาใช้ตรงนี้ คีย์ที่ตั้งใจซ่อนไว้จะหลุดออกไปทันที
 *
 * คีย์ตัวนี้จึงควรเป็นคนละตัว และตั้ง HTTP referrer restriction ไว้ใน Google
 * Cloud Console ถ้าไม่ได้ตั้งค่าไว้ หน้าประวัติจะไม่แสดงแผนที่ (ไม่ error)
 */
function readEmbedKey(): string {
  return process.env.GOOGLE_MAPS_EMBED_KEY?.trim() ?? "";
}

export default async function HistoryPage() {
  const state = await loadHistory();

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <Link
            href="/"
            className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl"
          >
            พัสดุไทย
            <span className="font-medium text-faint">.com</span>
          </Link>
          <Link
            href="/"
            className="rounded-lg px-3 py-2 text-sm font-medium text-faint transition-colors hover:bg-ink/5 hover:text-ink"
          >
            ค้นหาพัสดุ
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            ประวัติที่บันทึกไว้
          </h1>

          {state.kind === "unavailable" && (
            <p className="mt-3 text-sm leading-relaxed text-faint">
              ระบบสมาชิกยังไม่พร้อมใช้งาน ไม่ใช่ความผิดของคุณ ทีมงานยังตั้งค่าระบบไม่เสร็จ
              ระหว่างนี้ยังค้นหาพัสดุได้ตามปกติ
            </p>
          )}

          {state.kind === "guest" && (
            <div className="mt-3">
              <p className="text-sm leading-relaxed text-faint">
                หน้านี้เก็บพัสดุที่คุณกดบันทึกไว้ ต้องเข้าสู่ระบบก่อนถึงจะดูได้
              </p>
              <Link
                href="/"
                className="mt-5 inline-flex h-11 items-center rounded-xl bg-ink px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-strong"
              >
                กลับไปหน้าแรกเพื่อเข้าสู่ระบบ
              </Link>
            </div>
          )}

          {state.kind === "ready" && (
            <>
              <p className="mt-2 text-sm text-faint">
                {state.items.length === 0
                  ? "ยังไม่มีรายการที่บันทึกไว้"
                  : `${state.items.length} รายการ เรียงจากที่บันทึกล่าสุด`}
              </p>

              {state.items.length > 0 && (
                <HistorySummary summary={summarizeSavedTrackings(state.items)} />
              )}

              {state.items.length === 0 ? (
                <div className="mt-6 rounded-xl border border-dashed border-line-strong p-6 text-center">
                  <p className="text-sm leading-relaxed text-faint">
                    ค้นหาเลขพัสดุที่หน้าแรก แล้วกดปุ่ม &ldquo;บันทึกไว้&rdquo;
                    ที่การ์ดผลลัพธ์ รายการจะมาโผล่ที่นี่
                  </p>
                  <Link
                    href="/"
                    className="mt-4 inline-flex h-11 items-center rounded-xl bg-ink px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-strong"
                  >
                    ไปค้นหาพัสดุ
                  </Link>
                </div>
              ) : (
                <HistoryList items={state.items} mapEmbedKey={readEmbedKey()} />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

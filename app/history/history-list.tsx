"use client";

import { useCallback, useState } from "react";
import Link from "next/link";

import type { TrackingStatus } from "@/lib/carriers/types";
import {
  LOCATION_ACCURACY_NOTICE,
  deleteSavedTracking,
  displayTitleOf,
  refreshSavedTrackings,
  summarizeSavedTrackings,
  type SavedTracking,
} from "@/lib/saved-trackings";
import { needsStatusRefresh } from "@/lib/saved-refresh";
import { formatThaiDateTime, type UserFacingError } from "@/lib/tracking-view";
import DeleteSavedDialog from "./delete-saved-dialog";
import HistorySummary from "./history-summary";

/** โทนสีเดียวกับการ์ดผลลัพธ์ที่หน้าแรก */
const STATUS_TEXT_CLASS: Record<TrackingStatus, string> = {
  pending: "text-ink",
  in_transit: "text-ink",
  out_for_delivery: "text-ink",
  delivered: "text-ok",
  exception: "text-seal",
};

interface HistoryListProps {
  items: SavedTracking[];
  /**
   * แผนที่ถูกเปิดใช้งานอยู่ไหม — สวิตช์จากหน้าแอดมิน (ดู lib/app-settings.ts)
   *
   * ปิดแล้วการ์ดจะแสดงชื่อสถานที่เป็นข้อความแทน ซึ่งเป็นทางเดียวกับตอนที่
   * ไม่รู้พิกัดอยู่แล้ว จึงไม่มีหน้าตาแบบใหม่ให้ต้องออกแบบเพิ่ม
   */
  mapEnabled: boolean;
}

export default function HistoryList({ items, mapEnabled }: HistoryListProps) {
  // ลบแล้วเอาออกจากรายการทันที ไม่ต้องรอโหลดหน้าใหม่
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<SavedTracking | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);

  // แถวที่ server ส่งมาคือ snapshot ตอนกดบันทึก ซึ่งค้างได้เป็นวัน
  // (ดู app/api/saved/refresh/route.ts) เก็บเป็น state เพื่อทับด้วยของสดทีหลัง
  const [rows, setRows] = useState<SavedTracking[]>(items);

  /**
   * ใบไหนกำลังรอผลอยู่ — ว่างเปล่าเมื่อไม่มีอะไรกำลังยิง
   *
   * ⚠️ **ไม่มี auto-refresh ตอนเปิดหน้าอีกต่อไป** เดิมมี useEffect ยิงให้เอง
   * ซึ่งแปลว่าการเปิดหน้าหนึ่งครั้งจุดชนวนการยิง API หลายสิบครั้งโดยที่ผู้ใช้
   * ไม่ได้ขอ ตัดสินใจใหม่แล้วว่าผู้ใช้ต้องกดเองทุกครั้ง (โมเดลเดียวกับ ThaiEMS)
   * เพื่อประหยัดโควตาให้มากที่สุด
   *
   * ถ้าเห็น useEffect ที่เรียก refreshSavedTrackings() โผล่มาอีก แปลว่ามีคน
   * เอา auto กลับมาโดยไม่ได้ตั้งใจ — มีเทสต์เฝ้าอยู่ที่ lib/history-refresh.test.ts
   */
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [refreshError, setRefreshError] = useState(false);

  /**
   * การ์ดที่ภาพแผนที่โหลดไม่ขึ้น
   *
   * ⚠️ ไม่มีตัวนี้มาก่อน — <img> ที่ได้ 404 (ชนเพดานรายวัน หรือสวิตช์ถูกปิด
   * ระหว่างที่หน้ายังเปิดค้างอยู่) จะแสดงเป็นไอคอนรูปแตกในกล่องสูง 176px
   * ซึ่งผู้ใช้อ่านว่า "เว็บพัง" ไม่ใช่ "ฟีเจอร์นี้ปิดอยู่"
   *
   * โค้ดเดิมเคยคิดถึงเคสนี้แล้ว (มีคอมเมนต์เรื่อง bg-paper รองไว้เผื่อรูปโหลด
   * ไม่ขึ้น) แต่แก้แค่สีพื้นหลัง ไม่ได้แก้ตัวไอคอนแตก
   */
  const [mapFailedIds, setMapFailedIds] = useState<Set<string>>(new Set());

  const markMapFailed = useCallback((id: string) => {
    setMapFailedIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  /** ยิงรีเฟรชตามที่ผู้ใช้กด — ids ว่าง = ทุกใบที่ยังไม่ถึงปลายทาง */
  const runRefresh = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;

    setRefreshError(false);
    setBusyIds(new Set(ids));

    const updated = await refreshSavedTrackings(ids);

    if (updated.length > 0) {
      const byId = new Map(updated.map((row) => [row.id, row]));
      // ทับทีละใบตามลำดับเดิม ไม่เรียงใหม่ — ผู้ใช้กำลังอ่านรายการอยู่
      // การสลับที่ระหว่างอ่านคือสิ่งที่น่ารำคาญกว่าสถานะที่ช้าไปสองวินาที
      setRows((previous) => previous.map((row) => byId.get(row.id) ?? row));
    } else {
      // ไม่มีอะไรเปลี่ยน กับ ยิงไม่สำเร็จ แยกจากกันไม่ได้จากฝั่งนี้ (ดู
      // refreshSavedTrackings) จึงบอกกลางๆ ว่า "ไม่มีอะไรใหม่" ซึ่งจริงทั้งสองทาง
      setRefreshError(true);
    }

    setBusyIds(new Set());
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target === null) return;

    setDeletingId(target.id);
    setError(null);

    const outcome = await deleteSavedTracking(target.id);

    if (outcome.ok) {
      setRemovedIds((previous) => new Set(previous).add(target.id));
    } else {
      setError(outcome.error);
    }

    setDeletingId(null);
  }, [pendingDelete]);

  const visible = rows.filter((item) => !removedIds.has(item.id));

  // ใบที่ "กดค้นหาแล้วมีความหมาย" — ที่ถึงปลายทางแล้วไม่มีทางเปลี่ยนอีก
  // จึงไม่ขึ้นปุ่มให้กด (ดู needsStatusRefresh ใน lib/saved-refresh.ts)
  const pending = visible.filter(needsStatusRefresh);
  const anyBusy = busyIds.size > 0;

  if (visible.length === 0) {
    return (
      <p className="mt-6 rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-faint">
        ลบรายการครบทุกอันแล้ว
      </p>
    );
  }

  return (
    <>
      <HistorySummary summary={summarizeSavedTrackings(visible)} />

      {/* ปุ่มเดียวสำหรับทุกใบที่ยังไม่ถึงปลายทาง — ฝั่ง server หรี่การยิงไว้ที่
          4 ใบพร้อมกันอยู่แล้ว (REFRESH_CONCURRENCY) จึงไม่มีทางชนเพดาน
          5 req/s ของ Track123 ต่อให้กดตอนมีพัสดุค้างอยู่หลายสิบใบ */}
      {pending.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runRefresh(pending.map((item) => item.id))}
            disabled={anyBusy}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line-strong bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {anyBusy && <Spinner className="h-3.5 w-3.5 shrink-0" />}
            {anyBusy
              ? "กำลังค้นหา"
              : `ค้นหาสถานะล่าสุด (${pending.length})`}
          </button>
          <p className="text-xs leading-snug text-faint">
            อัปเดตเฉพาะพัสดุที่ยังไม่ถึงปลายทาง
          </p>
        </div>
      )}

      {refreshError && (
        <p role="status" className="mt-3 text-xs text-faint">
          ยังไม่มีความเคลื่อนไหวใหม่
        </p>
      )}

      {error !== null && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-line-strong bg-white p-3"
        >
          <p className="text-sm font-semibold text-seal">{error.title}</p>
          <p className="mt-0.5 text-sm text-faint">{error.detail}</p>
        </div>
      )}

      <ul className="mt-5 flex flex-col gap-4">
        {visible.map((item) => {
          // ไม่มีพิกัด = เราไม่รู้ว่าสาขานี้อยู่ไหนจริงๆ ห้ามปักหมุดเดา
          // (ดู lib/location-resolve.ts) แสดงชื่อสถานที่เป็นข้อความแทน
          //
          // ⚠️ ตัวนี้ตอบแค่ "มีพิกัดให้วาดไหม" ไม่เกี่ยวกับสวิตช์เลย —
          // ด่านสวิตช์อยู่ที่ปากทางเข้าของบล็อกแผนที่ทั้งก้อนข้างล่าง
          const showMap = item.lastLat !== null && item.lastLng !== null;

          // หมุดที่ไม่แม่นต้องบอกตรงๆ ว่าคลาดเคลื่อนได้เท่าไร ไม่งั้นมันจะสื่อ
          // ความแม่นยำที่เราไม่มี ซึ่งคือปัญหาเดิมที่ทั้งระบบพิกัดสาขาตั้งใจแก้
          // (ดู lib/geocode.ts) · null = แถวเก่าที่บันทึกก่อนมีคอลัมน์นี้
          // ไม่ขึ้นป้าย เพราะเราไม่รู้จริงๆ ว่าแม่นแค่ไหน
          const accuracy = item.lastLocationAccuracy;
          const accuracyNotice =
            accuracy === null ? null : LOCATION_ACCURACY_NOTICE[accuracy];

          return (
            <li
              key={item.id}
              className="overflow-hidden rounded-xl border border-line bg-white"
            >
              {/* แตะการ์ดทั้งใบ → หน้าแรกพร้อม ?track= ซึ่งจะค้นให้ทันที
                  นี่คือ action ที่ยิง API แทนปุ่มที่ลบไป — ยังเป็นการกดของผู้ใช้
                  เอง ไม่ใช่ auto (ดูกติกาที่ app/api/saved/refresh/route.ts)

                  ⚠️ ครอบแค่ "เนื้อการ์ด" ไม่รวมแถวปุ่มลบข้างล่าง — ปุ่มลบซ้อนอยู่
                  ในลิงก์เมื่อไร การกดลบจะพาไปหน้าอื่นด้วย ซึ่งเป็นกับดักคลาสสิก
                  ของการทำการ์ดกดได้ทั้งใบ */}
              <Link
                href={`/?track=${encodeURIComponent(item.trackingNumber)}`}
                aria-label={`ดูรายละเอียดของ ${displayTitleOf(item)}`}
                className="block transition-colors hover:bg-ink/[0.03] focus-visible:bg-ink/[0.03] focus-visible:outline-none"
              >
              <div className="p-5">
                <h2 className="font-display text-lg font-semibold leading-snug text-ink">
                  {displayTitleOf(item)}
                </h2>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
                  {item.trackingNumber}
                  {item.carrierName !== null && ` · ${item.carrierName}`}
                </p>

                {/* บันทึกไว้เฉยๆ ยังไม่เคยค้น (ปุ่ม "บันทึกไว้" ที่หน้าแรก) —
                    ต้องบอกให้ชัดว่ายังไม่รู้สถานะ ไม่ใช่ปล่อยว่างจนดูเหมือน
                    บันทึกไม่ติด และไม่ใช่ error เพราะไม่มีอะไรผิดพลาดเลย */}
                {item.lastStatusText === null ? (
                  <p className="mt-3 text-base font-medium text-faint">
                    รอค้นหา
                  </p>
                ) : (
                  <p
                    className={`mt-3 text-base font-medium ${
                      item.lastStatus === null
                        ? "text-ink"
                        : STATUS_TEXT_CLASS[item.lastStatus]
                    }`}
                  >
                    {item.lastStatusText}
                  </p>
                )}

                <p className="mt-1 text-xs text-faint sm:text-sm">
                  {item.lastUpdatedAt === null
                    ? "ยังไม่มีความเคลื่อนไหว"
                    : `อัปเดต ${formatThaiDateTime(item.lastUpdatedAt)} น.`}
                  {item.lastLocationText !== null && ` · ${item.lastLocationText}`}
                </p>
              </div>

              {/* ⚠️ ด่านสวิตช์อยู่ตรงนี้ที่เดียว — ปากทางเข้าของบล็อกแผนที่ทั้งก้อน
                  ปิดแล้วต้องไม่เหลือร่องรอยอะไรเลย ทั้งรูปแผนที่ ทั้งข้อความ
                  สำรองกรณีไม่มีพิกัด ทั้งไอคอนหมุด

                  เคยวางด่านลึกกว่านี้ (อยู่ในเงื่อนไข showMap) ซึ่งครอบแค่กิ่ง
                  "มีพิกัด" ส่วนกิ่ง "ไม่มีพิกัด" หลุดออกมา ผู้ใช้จึงยังเห็นกล่อง
                  "ยังไม่มีพิกัดของจุดนี้ จึงยังแสดงแผนที่ไม่ได้" ทั้งที่ปิดสวิตช์แล้ว
                  — ด่านที่วางลึกกว่าจุดที่ต้องปิด จะครอบได้ไม่ครบเสมอ

                  ชื่อสถานที่ยังเห็นได้อยู่ในบรรทัด "อัปเดต … · <สถานที่>" ข้างบน
                  การปิดแผนที่จึงไม่ได้ทำให้ผู้ใช้เสียข้อมูลอะไรไป */}
              {mapEnabled && (
                <>
              {/* แผนที่เป็นภาพนิ่ง ลาก/ซูม/กดเข้าไปดูส่วนอื่นไม่ได้ — สิ่งที่ผู้ใช้
                  ต้องรู้คือ "พัสดุอยู่แถวนี้" ภาพเดียวจบ

                  ยิงผ่าน /api/map ของเราเอง ไม่ใช่ URL ของ Google ตรงๆ คีย์จึง
                  ไม่เคยออกจากเครื่องเรา (Embed API เดิมบังคับให้ใส่คีย์ลงใน URL
                  ที่ผู้ใช้เปิดดู source เห็นได้)

                  bg-paper รองไว้ข้างหลัง เผื่อรูปโหลดไม่ขึ้น (โควตาหมด หรือเน็ต
                  ของผู้ใช้บล็อก) จะได้ไม่เห็นกล่องเทาของเบราว์เซอร์ */}
              {showMap && !mapFailedIds.has(item.id) ? (
                <div className="border-t border-line bg-paper">
                  {/* eslint-disable-next-line @next/next/no-img-element --
                      next/image ไม่ช่วยอะไรตรงนี้ ภาพมาจาก API route ของเราเอง
                      ที่กำหนดขนาดตายตัวและตั้ง Cache-Control ไว้แล้ว การให้ Next
                      มาแปลงซ้ำมีแต่จะเพิ่มงานฝั่งเซิร์ฟเวอร์เปล่าๆ */}
                  <img
                    src={`/api/map?lat=${item.lastLat}&lng=${item.lastLng}${
                      accuracy === null ? "" : `&accuracy=${accuracy}`
                    }`}
                    alt={
                      (item.lastLocationText === null
                        ? `แผนที่ตำแหน่งล่าสุดของ ${displayTitleOf(item)}`
                        : `แผนที่แสดงตำแหน่งของ ${displayTitleOf(item)} ที่ ${item.lastLocationText}`) +
                      (accuracyNotice === null ? "" : ` (${accuracyNotice})`)
                    }
                    loading="lazy"
                    width={640}
                    height={288}
                    /* โหลดไม่ขึ้นด้วยเหตุใดก็ตาม → ซ่อนภาพแล้วตกไปใช้กล่อง
                       ข้อความข้างล่างแทน · ไม่บอกผู้ใช้ว่าชนเพดานหรือสวิตช์ปิด
                       เพราะเป็นเรื่องภายในที่เขาทำอะไรกับมันไม่ได้ */
                    onError={() => markMapFailed(item.id)}
                    className="block h-44 w-full object-cover sm:h-52"
                  />

                  {accuracyNotice !== null && (
                    /* ป้ายนี้ไม่ใช่ของประดับ — มันคือความต่างระหว่าง "บอกว่า
                       พัสดุอยู่ตรงนี้" กับ "บอกว่าพัสดุอยู่แถวนี้" ซึ่งเป็น
                       สิ่งเดียวที่เรารู้จริงเมื่อพิกัดไม่ได้มาจากจุดที่ยืนยันแล้ว */
                    <p className="flex items-start gap-2 border-t border-line px-5 py-2.5 text-xs text-faint">
                      <PlaceMark className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {accuracyNotice}
                    </p>
                  )}
                </div>
              ) : (
                item.lastLocationText !== null && (
                  /* ไม่รู้พิกัดของสาขานี้ — บอกตรงๆ ว่าอยู่ที่ไหนเป็นข้อความ
                     ดีกว่าปักหมุดมั่ว และดีกว่าปล่อยช่องว่างเปล่าให้ผู้ใช้เดาเอง */
                  <div className="flex items-start gap-2.5 border-t border-line bg-paper px-5 py-4">
                    <PlaceMark className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug text-body">
                        {item.lastLocationText}
                      </p>
                      {/* เหตุผลต้องตรงกับความจริง — ตอนสวิตช์ปิด เรารู้พิกัดอยู่
                          การบอกว่า "ยังไม่มีพิกัด" คือการโกหกผู้ใช้เรื่องที่
                          ตรวจสอบไม่ได้ ซึ่งแย่กว่าการไม่บอกอะไรเลย

                          กรณีภาพโหลดไม่ขึ้นก็เหมือนกัน: เรารู้พิกัด แค่วาดไม่ได้
                          ตอนนี้ จึงต้องใช้คนละประโยค */}
                      <p className="mt-0.5 text-xs text-faint">
                        {mapFailedIds.has(item.id)
                          ? "แสดงแผนที่ไม่ได้ตอนนี้"
                          : "ยังไม่มีพิกัดของจุดนี้ จึงยังแสดงแผนที่ไม่ได้"}
                      </p>
                    </div>
                  </div>
                )
              )}
                </>
              )}

              </Link>

              {/* เหลือแค่ปุ่มลบ — "ดูอีกครั้ง" กับ "ค้นหาสถานะ" ถูกลบทิ้งเพราะ
                  ทำหน้าที่เดียวกันกับการแตะการ์ด (ดูลิงก์คลุมทั้งใบข้างบน)
                  ปุ่มสามอันที่พาไปที่เดียวกันคือการให้ผู้ใช้ต้องเลือกโดยไม่มี
                  ความหมาย */}
              <div className="flex flex-wrap gap-2.5 border-t border-line bg-paper/60 px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => setPendingDelete(item)}
                  disabled={deletingId === item.id}
                  className="inline-flex h-10 items-center rounded-xl border border-line-strong bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingId === item.id ? "กำลังลบ" : "ลบ"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <DeleteSavedDialog
        open={pendingDelete !== null}
        title={pendingDelete === null ? "" : displayTitleOf(pendingDelete)}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

/** วงกลมหมุนระหว่างรอผลรีเฟรช — เล็กและเงียบ ไม่ใช่ตัวเอกของหน้า */
function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** หมุดเล็กหน้าชื่อสถานที่ — ชุดเดียวกับที่ใช้ในไทม์ไลน์หน้าแรก */
function PlaceMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21c4-4.4 6-7.6 6-10a6 6 0 1 0-12 0c0 2.4 2 5.6 6 10z" />
      <circle cx="12" cy="11" r="2.3" />
    </svg>
  );
}

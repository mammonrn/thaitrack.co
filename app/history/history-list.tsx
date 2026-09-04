"use client";

import { useCallback, useEffect, useState } from "react";
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
}

export default function HistoryList({ items }: HistoryListProps) {
  // ลบแล้วเอาออกจากรายการทันที ไม่ต้องรอโหลดหน้าใหม่
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<SavedTracking | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);

  // แถวที่ server ส่งมาคือ snapshot ตอนกดบันทึก ซึ่งค้างได้เป็นวัน
  // (ดู app/api/saved/refresh/route.ts) เก็บเป็น state เพื่อทับด้วยของสดทีหลัง
  const [rows, setRows] = useState<SavedTracking[]>(items);

  // มีอะไรให้รีเฟรชจริงไหม — ถ้าทุกใบถึงปลายทางแล้วก็ไม่ต้องยิงอะไรเลย
  // ตัดสินจาก items (ค่าตั้งต้นจาก server) ไม่ใช่ rows เพื่อไม่ให้ effect
  // วนซ้ำหลังรีเฟรชเสร็จ
  const [refreshing, setRefreshing] = useState(() =>
    items.some(needsStatusRefresh),
  );

  useEffect(() => {
    if (!items.some(needsStatusRefresh)) return;

    // หน้าถูกปิดไปแล้วห้าม setState ต่อ — ไม่งั้นได้ warning และเขียนทับ
    // สิ่งที่ผู้ใช้ทำไปแล้วในหน้าใหม่
    let alive = true;

    void (async () => {
      const updated = await refreshSavedTrackings();
      if (!alive) return;

      if (updated.length > 0) {
        const byId = new Map(updated.map((row) => [row.id, row]));
        // ทับทีละใบตามลำดับเดิม ไม่เรียงใหม่ — ผู้ใช้กำลังอ่านรายการอยู่
        // การสลับที่ระหว่างอ่านคือสิ่งที่น่ารำคาญกว่าสถานะที่ช้าไปสองวินาที
        setRows((previous) =>
          previous.map((row) => byId.get(row.id) ?? row),
        );
      }

      setRefreshing(false);
    })();

    return () => {
      alive = false;
    };
  }, [items]);

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

      {refreshing && (
        /* บอกว่ากำลังทำอะไรอยู่ ไม่ใช่ปล่อยให้ตัวเลขกระโดดเองเฉยๆ — และไม่บัง
           รายการไว้ระหว่างรอ ผู้ใช้อ่านของเดิมต่อได้ทันทีที่หน้าขึ้น */
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-xs text-faint"
        >
          <Spinner className="h-3.5 w-3.5 shrink-0" />
          กำลังอัปเดตสถานะล่าสุด
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
              <div className="p-5">
                <h2 className="font-display text-lg font-semibold leading-snug text-ink">
                  {displayTitleOf(item)}
                </h2>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
                  {item.trackingNumber}
                  {item.carrierName !== null && ` · ${item.carrierName}`}
                </p>

                {item.lastStatusText !== null && (
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

              {/* แผนที่เป็นภาพนิ่ง ลาก/ซูม/กดเข้าไปดูส่วนอื่นไม่ได้ — สิ่งที่ผู้ใช้
                  ต้องรู้คือ "พัสดุอยู่แถวนี้" ภาพเดียวจบ

                  ยิงผ่าน /api/map ของเราเอง ไม่ใช่ URL ของ Google ตรงๆ คีย์จึง
                  ไม่เคยออกจากเครื่องเรา (Embed API เดิมบังคับให้ใส่คีย์ลงใน URL
                  ที่ผู้ใช้เปิดดู source เห็นได้)

                  bg-paper รองไว้ข้างหลัง เผื่อรูปโหลดไม่ขึ้น (โควตาหมด หรือเน็ต
                  ของผู้ใช้บล็อก) จะได้ไม่เห็นกล่องเทาของเบราว์เซอร์ */}
              {showMap ? (
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
                      <p className="mt-0.5 text-xs text-faint">
                        ยังไม่มีพิกัดของจุดนี้ จึงยังแสดงแผนที่ไม่ได้
                      </p>
                    </div>
                  </div>
                )
              )}

              <div className="flex flex-wrap gap-2.5 border-t border-line bg-paper/60 px-5 py-3.5">
                <Link
                  href={`/?track=${encodeURIComponent(item.trackingNumber)}`}
                  className="inline-flex h-10 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-ink-strong"
                >
                  ดูอีกครั้ง
                </Link>
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

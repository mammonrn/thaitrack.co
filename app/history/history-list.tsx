"use client";

import { useCallback, useState } from "react";
import Link from "next/link";

import type { TrackingStatus } from "@/lib/carriers/types";
import {
  deleteSavedTracking,
  displayTitleOf,
  type SavedTracking,
} from "@/lib/saved-trackings";
import { formatThaiDateTime, type UserFacingError } from "@/lib/tracking-view";
import DeleteSavedDialog from "./delete-saved-dialog";

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
  /** ว่างได้ ถ้าไม่ได้ตั้งคีย์ไว้ก็แค่ไม่แสดงแผนที่ */
  mapEmbedKey: string;
}

export default function HistoryList({ items, mapEmbedKey }: HistoryListProps) {
  // ลบแล้วเอาออกจากรายการทันที ไม่ต้องรอโหลดหน้าใหม่
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<SavedTracking | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);

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

  const visible = items.filter((item) => !removedIds.has(item.id));

  if (visible.length === 0) {
    return (
      <p className="mt-6 rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-faint">
        ลบรายการครบทุกอันแล้ว
      </p>
    );
  }

  return (
    <>
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
          const hasCoordinates = item.lastLat !== null && item.lastLng !== null;
          const showMap = hasCoordinates && mapEmbedKey !== "";

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

              {/* bg-paper รองไว้ข้างหลัง เผื่อแผนที่โหลดไม่ขึ้น (คีย์หมดโควตา หรือ
                  เน็ตของผู้ใช้บล็อก Google) จะได้ไม่เห็นกล่องเทาของเบราว์เซอร์ */}
              {showMap && (
                <div className="border-t border-line bg-paper">
                  <iframe
                    // Embed API แสดงหมุดเดียวจากพิกัดที่เก็บไว้ ไม่ต้องยิง geocode ซ้ำ
                    src={`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(mapEmbedKey)}&q=${item.lastLat},${item.lastLng}&zoom=14&language=th`}
                    title={`แผนที่ตำแหน่งล่าสุดของ ${displayTitleOf(item)}`}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    className="block h-44 w-full border-0 sm:h-52"
                  />
                </div>
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

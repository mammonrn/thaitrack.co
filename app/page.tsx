"use client";

import { useState } from "react";
import Link from "next/link";

import type { TrackingResult, TrackingStatus } from "@/lib/carriers/types";
import {
  EMPTY_INPUT_MESSAGE,
  formatThaiDateTime,
  requestTracking,
} from "@/lib/tracking-view";

/** สีของป้ายสถานะ — คุมโทนน้ำเงิน-ขาวเป็นหลัก ใช้สีอื่นเฉพาะตอนสำเร็จ/มีปัญหา */
const STATUS_BADGE_CLASS: Record<TrackingStatus, string> = {
  pending: "bg-slate-100 text-slate-700 ring-slate-200",
  in_transit: "bg-blue-50 text-blue-700 ring-blue-200",
  out_for_delivery: "bg-blue-100 text-blue-800 ring-blue-300",
  delivered: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  exception: "bg-rose-50 text-rose-700 ring-rose-200",
};

export default function Home() {
  const [trackingNumber, setTrackingNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading) return;

    if (trackingNumber.trim() === "") {
      setResult(null);
      setErrorMessage(EMPTY_INPUT_MESSAGE);
      return;
    }

    setIsLoading(true);
    setResult(null);
    setErrorMessage(null);

    const outcome = await requestTracking(trackingNumber);
    if (outcome.ok) {
      setResult(outcome.result);
    } else {
      setErrorMessage(outcome.message);
    }

    setIsLoading(false);
  }

  // timeline โชว์จากล่าสุดไปเก่าสุด (API ส่งมาเรียงจากเก่าไปใหม่)
  const eventsNewestFirst = result ? [...result.events].reverse() : [];

  return (
    <div className="flex flex-1 flex-col bg-white text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <Link href="#" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white sm:h-9 sm:w-9">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
                <path d="m3 8 9 5 9-5" />
                <path d="M12 13v8" />
              </svg>
            </span>
            <span className="text-lg font-bold tracking-tight sm:text-xl">
              พัสดุไทย
              <span className="text-blue-600">.com</span>
            </span>
          </Link>

          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-blue-50 hover:text-blue-700"
            aria-label="เข้าสู่ระบบ"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
            <span className="hidden sm:inline">เข้าสู่ระบบ</span>
          </button>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-gradient-to-b from-blue-50 to-white px-4 py-12 sm:px-6 sm:py-20">
          <div className="mx-auto w-full max-w-2xl text-center">
            <h1 className="text-2xl font-bold leading-snug tracking-tight sm:text-4xl">
              ติดตามพัสดุทุกขนส่งในที่เดียว
            </h1>

            <form
              onSubmit={handleSubmit}
              className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:gap-2"
            >
              <label htmlFor="tracking-number" className="sr-only">
                เลขพัสดุ
              </label>
              <input
                id="tracking-number"
                type="text"
                inputMode="text"
                autoComplete="off"
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="กรอกเลขพัสดุของคุณ"
                className="h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 sm:h-16 sm:px-5 sm:text-lg"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="flex h-14 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 active:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-400 sm:h-16 sm:w-auto sm:px-10 sm:text-lg"
              >
                {isLoading && (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5 animate-spin"
                    aria-hidden="true"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      fill="none"
                      className="opacity-25"
                    />
                    <path
                      d="M12 2a10 10 0 0 1 10 10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>
                )}
                {isLoading ? "กำลังค้นหา..." : "ติดตาม"}
              </button>
            </form>

            <p className="mt-3 text-xs leading-relaxed text-slate-500 sm:mt-4 sm:text-sm">
              รองรับ ไปรษณีย์ไทย, Flash Express, Kerry Express, J&amp;T Express,
              SPX Express และอื่นๆ
            </p>
          </div>
        </section>

        {/* ผลการติดตามพัสดุ */}
        <section
          className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12"
          aria-live="polite"
          aria-busy={isLoading}
        >
          {errorMessage && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 sm:p-5">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 h-5 w-5 shrink-0"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5" />
                <path d="M12 16h.01" />
              </svg>
              <p className="text-sm leading-relaxed sm:text-base">
                {errorMessage}
              </p>
            </div>
          )}

          {result && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
              {/* สรุปสถานะปัจจุบัน */}
              <div className="border-b border-slate-200 bg-gradient-to-b from-blue-50 to-white p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 sm:text-sm">
                  <span className="font-medium text-slate-700">
                    {result.carrierName}
                  </span>
                  <span className="font-mono tracking-wide">
                    {result.trackingNumber}
                  </span>
                </div>

                <div className="mt-3">
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset sm:text-sm ${STATUS_BADGE_CLASS[result.status]}`}
                  >
                    {result.statusText}
                  </span>
                </div>

                {result.lastUpdated && (
                  <p className="mt-3 text-xs text-slate-500 sm:text-sm">
                    อัปเดตล่าสุด {formatThaiDateTime(result.lastUpdated)} น.
                  </p>
                )}
              </div>

              {/* timeline ล่าสุดอยู่บนสุด */}
              <div className="bg-white p-5 sm:p-6">
                {eventsNewestFirst.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    ยังไม่มีความเคลื่อนไหวของพัสดุชิ้นนี้
                  </p>
                ) : (
                  <ol>
                    {eventsNewestFirst.map((item, index) => {
                      const isLatest = index === 0;
                      const isLast = index === eventsNewestFirst.length - 1;

                      return (
                        <li
                          key={`${item.time}-${index}`}
                          className="relative flex gap-4 pb-6 last:pb-0"
                        >
                          {/* เส้นเชื่อมจุด — ไม่ลากเลยรายการสุดท้าย */}
                          {!isLast && (
                            <span
                              className="absolute left-[7px] top-5 h-full w-px bg-slate-200"
                              aria-hidden="true"
                            />
                          )}
                          <span
                            className={`relative mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full ring-4 ring-white ${
                              isLatest ? "bg-blue-600" : "bg-slate-300"
                            }`}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm leading-snug sm:text-base ${
                                isLatest
                                  ? "font-semibold text-slate-900"
                                  : "text-slate-700"
                              }`}
                            >
                              {item.description}
                            </p>
                            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                              {formatThaiDateTime(item.time)} น.
                            </p>
                            {item.location && (
                              <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
                                {item.location}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white">
        <nav className="mx-auto flex w-full max-w-5xl items-center justify-center gap-6 px-4 py-6 text-sm font-medium text-slate-600 sm:gap-10 sm:px-6">
          <Link href="#" className="transition hover:text-blue-700">
            ติดตาม
          </Link>
          <Link href="#" className="transition hover:text-blue-700">
            ประวัติ
          </Link>
          <Link href="#" className="transition hover:text-blue-700">
            รหัสไปรษณีย์
          </Link>
        </nav>
      </footer>
    </div>
  );
}

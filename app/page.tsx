"use client";

import { useState } from "react";
import Link from "next/link";

export default function Home() {
  const [trackingNumber, setTrackingNumber] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // TODO: เรียก API ติดตามพัสดุด้วยค่า trackingNumber
  }

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
                className="h-14 w-full shrink-0 rounded-xl bg-blue-600 px-6 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 active:bg-blue-800 sm:h-16 sm:w-auto sm:px-10 sm:text-lg"
              >
                ติดตาม
              </button>
            </form>

            <p className="mt-3 text-xs leading-relaxed text-slate-500 sm:mt-4 sm:text-sm">
              รองรับ ไปรษณีย์ไทย, Flash Express, Kerry Express, J&amp;T Express,
              SPX Express และอื่นๆ
            </p>
          </div>
        </section>

        {/* พื้นที่ผลลัพธ์ */}
        <section className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
          {/* TODO: แสดงผลการติดตามพัสดุ */}
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

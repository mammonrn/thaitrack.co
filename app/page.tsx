"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import AuthButton from "./auth-button";
import InstallButton from "./install-button";
import ScanButton from "./scan-button";
import SaveTrackingButton from "./save-tracking-button";

import type { TrackingResult, TrackingStatus } from "@/lib/carriers/types";
import { translateStatusText } from "@/lib/status-th";
import { groupEventsByLocation } from "@/lib/timeline-groups";
import {
  EMPTY_INPUT_ERROR,
  QUEUED_MESSAGE,
  QUEUED_NOTICE_AFTER_MS,
  SEARCHING_MESSAGE,
  formatPostmark,
  formatThaiDateTime,
  requestTracking,
  type UserFacingError,
} from "@/lib/tracking-view";

/**
 * สีของข้อความสถานะ — ส่วนที่เหลือของหน้าอยู่ในโทนหมึกน้ำเงินทั้งหมด
 * ใช้สีต่างเฉพาะสองกรณีที่ผู้ใช้ต้องรู้ทันทีว่าจบดีหรือมีปัญหา
 */
const STATUS_TEXT_CLASS: Record<TrackingStatus, string> = {
  pending: "text-ink",
  in_transit: "text-ink",
  out_for_delivery: "text-ink",
  delivered: "text-ok",
  exception: "text-seal",
};

const CARRIERS = [
  "ไปรษณีย์ไทย",
  "Flash Express",
  "Kerry Express",
  "J&T Express",
  "SPX Express",
];

export default function Home() {
  const [trackingNumber, setTrackingNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);
  // รอนานเกินปกติ = คำขอน่าจะติดคิวฝั่งเซิร์ฟเวอร์อยู่ (หรือกำลังถูกลองใหม่ให้)
  // ยังไม่ใช่ความล้มเหลว จึงแค่เปลี่ยนถ้อยคำระหว่างรอ ไม่ขึ้นเป็น error
  const [isQueued, setIsQueued] = useState(false);

  // ตั้งนาฬิกาไว้เฉยๆ แล้วปล่อยให้ callback เป็นคนเปลี่ยน state
  // การรีเซ็ตกลับเป็น false ทำตอนเริ่มค้นหารอบใหม่แทน ไม่ทำในนี้ เพราะ setState
  // ตรงๆ ใน effect ทำให้เกิด cascading render
  useEffect(() => {
    if (!isLoading) return;

    const timer = setTimeout(() => setIsQueued(true), QUEUED_NOTICE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [isLoading]);

  function applyOutcome(outcome: Awaited<ReturnType<typeof requestTracking>>) {
    if (outcome.ok) {
      setResult(outcome.result);
    } else {
      setError(outcome.error);
    }
  }

  /**
   * ค้นหาจากเลขที่สแกนมาได้
   *
   * แยกจาก handleSubmit เพราะไม่ได้มาจากการ submit ฟอร์ม และต้องเติมเลขลงช่อง
   * ให้ผู้ใช้เห็นด้วยว่าระบบอ่านได้ว่าอะไร
   */
  async function runSearchFromScan(value: string) {
    setTrackingNumber(value);
    setIsLoading(true);
    setIsQueued(false);
    setResult(null);
    setError(null);

    applyOutcome(await requestTracking(value));
    setIsLoading(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading) return;

    if (trackingNumber.trim() === "") {
      setResult(null);
      setError(EMPTY_INPUT_ERROR);
      return;
    }

    setIsLoading(true);
    setIsQueued(false);
    setResult(null);
    setError(null);

    applyOutcome(await requestTracking(trackingNumber));
    setIsLoading(false);
  }

  // ปุ่ม "ดูอีกครั้ง" ในหน้าประวัติพามาที่ /?track=<เลขพัสดุ> ให้ค้นหาให้เลย
  //
  // อ่านจาก window.location เองแทน useSearchParams เพื่อให้หน้านี้ยัง prerender
  // เป็น static ได้ (useSearchParams บังคับให้ต้องมี Suspense ครอบ) และยิงค้นหา
  // ก่อนแล้วค่อยอัปเดต state ทีเดียวหลัง await เพื่อไม่ให้เกิด cascading render
  // จากการ setState ตรงๆ ใน effect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("track")?.trim() ?? "";
    if (requested === "") return;

    // ล้าง param ทิ้ง ไม่งั้นกด refresh ทีหลังจะยิงค้นหาซ้ำโดยไม่ได้ตั้งใจ
    params.delete("track");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query === "" ? "" : `?${query}`}`,
    );

    let isActive = true;

    async function searchFromLink() {
      const outcome = await requestTracking(requested);
      if (!isActive) return;

      setTrackingNumber(requested);
      applyOutcome(outcome);
    }

    void searchFromLink();

    return () => {
      isActive = false;
    };
  }, []);

  // timeline โชว์จากล่าสุดไปเก่าสุด (API ส่งมาเรียงจากเก่าไปใหม่)
  // แล้วรวมเหตุการณ์ที่เกิดที่เดียวกันติดกันเข้าเป็นกลุ่ม
  const timelineGroups = groupEventsByLocation(
    result === null ? [] : [...result.events].reverse(),
  );

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <Link href="#" className="flex items-center gap-2.5">
            <BrandMark className="h-8 w-8 text-ink sm:h-9 sm:w-9" />
            <span className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl">
              พัสดุไทย
              <span className="font-medium text-faint">.com</span>
            </span>
          </Link>

          <div className="flex items-center gap-1">
            <InstallButton />
            <AuthButton />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero — ช่องกรอกคือพระเอกเพียงอย่างเดียวของโซนนี้ */}
        <section className="px-4 pt-10 pb-8 sm:px-6 sm:pt-16 sm:pb-12">
          <div className="mx-auto w-full max-w-xl text-center">
            <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[42px]">
              พัสดุถึงไหนแล้ว
            </h1>
            <p className="mx-auto mt-2.5 max-w-md text-sm leading-relaxed text-faint sm:mt-3 sm:text-base">
              พิมพ์เลขพัสดุครั้งเดียว เราไล่ถามให้ทุกขนส่ง
              ไม่ต้องจำว่าส่งมาจากเจ้าไหน
            </p>

            <form
              onSubmit={handleSubmit}
              className="mt-6 flex flex-col gap-2.5 sm:mt-8 sm:flex-row"
            >
              <label htmlFor="tracking-number" className="sr-only">
                เลขพัสดุ
              </label>
              <div className="relative flex-1">
              <input
                id="tracking-number"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="เช่น EE000000000TH"
                // เว้นที่ด้านขวาให้ปุ่มกล้อง ไม่ให้ตัวอักษรวิ่งไปทับ
                className="h-14 w-full rounded-xl border border-line-strong bg-white pl-4 pr-14 text-center font-body text-base text-body outline-none transition-colors placeholder:text-faint/70 hover:border-ink/30 focus:border-ink sm:h-15 sm:pl-5 sm:text-left sm:text-lg"
              />
              <ScanButton onDetected={(value) => void runSearchFromScan(value)} />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="h-14 shrink-0 rounded-xl bg-ink px-8 font-display text-base font-semibold text-white transition-colors hover:bg-ink-strong disabled:cursor-not-allowed disabled:bg-ink-busy sm:h-15 sm:text-lg"
              >
                {isLoading ? "กำลังค้นหา…" : "ค้นหาพัสดุ"}
              </button>
            </form>

            <p className="mt-4 text-xs leading-relaxed text-faint sm:mt-5 sm:text-sm">
              {CARRIERS.join(" · ")} และอื่นๆ
            </p>
          </div>
        </section>

        {/* ผลการค้นหา */}
        {/* จอใหญ่ให้การ์ดผลลัพธ์กว้างกว่า hero เล็กน้อย ไม่ให้ดูลอยกลางจอโล่งๆ */}
        <section
          className="mx-auto w-full max-w-xl px-4 pb-12 sm:max-w-2xl sm:px-6 sm:pb-16"
          aria-live="polite"
          aria-busy={isLoading}
        >
          {isLoading && (
            <div className="flex flex-col items-center gap-4 py-6">
              <Postmark spinning />
              <p className="text-sm text-faint">
                {isQueued ? QUEUED_MESSAGE : SEARCHING_MESSAGE}
              </p>
            </div>
          )}

          {!isLoading && error && (
            <div className="animate-rise rounded-xl border border-line border-l-[3px] border-l-seal bg-white p-5 sm:p-6">
              <p className="font-display text-base font-semibold text-ink sm:text-lg">
                {error.title}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-faint">
                {error.detail}
              </p>
            </div>
          )}

          {!isLoading && result && (
            <article className="animate-rise overflow-hidden rounded-xl border border-line bg-white">
              {/* หัวการ์ด: ตราประทับ + สถานะปัจจุบัน + ปุ่มบันทึก
                  จอแคบให้ตราประทับกับปุ่มบันทึกอยู่แถวบน แล้วข้อความสถานะตกลงมา
                  แถวล่างเต็มความกว้าง (order-* สลับลำดับให้จอกว้างเรียงเป็นแถวเดียว)
                  ปุ่มบันทึกอยู่บนสุดเพื่อให้เห็นทันทีโดยไม่ต้องเลื่อนผ่านไทม์ไลน์ */}
              <div className="flex flex-wrap items-center gap-3 p-5 sm:flex-nowrap sm:gap-6 sm:p-6">
                <div className="order-1">
                  <Postmark postmark={formatPostmark(result.lastUpdated)} />
                </div>

                <div className="order-2 ml-auto sm:order-3 sm:ml-0">
                  <SaveTrackingButton trackingNumber={result.trackingNumber} />
                </div>

                <div className="order-3 min-w-0 basis-full sm:order-2 sm:flex-1 sm:basis-auto">
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint sm:text-xs">
                    {result.trackingNumber}
                  </p>
                  <p
                    className={`mt-1 font-display text-xl font-semibold leading-snug sm:text-2xl ${STATUS_TEXT_CLASS[result.status]}`}
                  >
                    {result.statusText}
                  </p>
                  <p className="mt-1.5 text-xs text-faint sm:text-sm">
                    {result.carrierName}
                    {result.lastUpdated &&
                      ` · อัปเดต ${formatThaiDateTime(result.lastUpdated)} น.`}
                  </p>
                </div>
              </div>

              {/* ไทม์ไลน์ — จัดกลุ่มตามสถานที่ ให้กวาดตาหาว่า "ตอนนี้อยู่ไหน" ได้เร็ว
                  ส่วนนี้ต้องเงียบ ปล่อยให้ตราประทับเป็นจุดเดียวที่เด่น (ดู DESIGN.md) */}
              <div className="border-t border-line p-5 sm:p-6">
                {timelineGroups.length === 0 ? (
                  <p className="text-sm text-faint">
                    ยังไม่มีความเคลื่อนไหวของพัสดุชิ้นนี้
                  </p>
                ) : (
                  <ol className="flex flex-col gap-6">
                    {timelineGroups.map((group, groupIndex) => (
                      <li key={`${group.location ?? "ไม่ระบุ"}-${groupIndex}`}>
                        {/* หัวกลุ่มสถานที่ — เส้นบางกับตัวอักษรเล็ก เลียนหัวข้อ
                            ในแบบฟอร์มไปรษณีย์ ไม่แย่งสายตาไปจากตราประทับ */}
                        <div className="flex items-center gap-2.5">
                          <PlaceMark className="h-3.5 w-3.5 shrink-0 text-faint" />
                          {/* ไม่ใส่ uppercase เพราะจะไปเปลี่ยนรูปชื่อสถานที่ที่ขนส่ง
                              ส่งมา ("Shenzhen Bao'an International Airport" กลายเป็น
                              ตะโกนทั้งบรรทัด) ชื่อสถานที่ต้องคงตามต้นฉบับ */}
                          <h3 className="min-w-0 truncate text-xs font-semibold tracking-[0.04em] text-faint">
                            {group.location ?? "ไม่ระบุสถานที่"}
                          </h3>
                          <span
                            className="h-px flex-1 bg-line"
                            aria-hidden="true"
                          />
                        </div>

                        <ol className="mt-3 pl-1">
                          {group.events.map((item, eventIndex) => {
                            const isLatest = groupIndex === 0 && eventIndex === 0;
                            const isLastInGroup =
                              eventIndex === group.events.length - 1;

                            return (
                              <li
                                key={`${item.time}-${eventIndex}`}
                                className="relative flex gap-4 pb-4 last:pb-0"
                              >
                                {!isLastInGroup && (
                                  <span
                                    className="absolute left-[5px] top-4 h-full w-px bg-line"
                                    aria-hidden="true"
                                  />
                                )}
                                <span
                                  className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ${
                                    isLatest
                                      ? "bg-ink"
                                      : "border border-line bg-paper"
                                  }`}
                                  aria-hidden="true"
                                />
                                <div className="min-w-0 flex-1">
                                  <p
                                    className={`text-sm leading-snug sm:text-base ${
                                      isLatest
                                        ? "font-medium text-body"
                                        : "text-faint"
                                    }`}
                                  >
                                    {translateStatusText(item.description)}
                                  </p>
                                  <p className="mt-1 text-xs text-faint sm:text-sm">
                                    {formatThaiDateTime(item.time)} น.
                                  </p>
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </article>
          )}
        </section>
      </main>

    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Signature element — ตราประทับไปรษณีย์
 *
 * ใช้ motif เดียวกันสองจังหวะ: หมุนตอนกำลังค้นหา และ "ประทับ" ลงตอนได้ผล
 * แอนิเมชันทั้งหมดถูกปิดอัตโนมัติเมื่อผู้ใช้ตั้ง prefers-reduced-motion
 * (กติกาอยู่ใน app/globals.css)
 * ------------------------------------------------------------------ */

function Postmark({
  postmark,
  spinning = false,
}: {
  postmark?: { date: string; time: string } | null;
  spinning?: boolean;
}) {
  return (
    <span
      className={`relative grid h-16 w-16 shrink-0 place-items-center sm:h-[88px] sm:w-[88px] ${
        spinning ? "" : "animate-seal-press"
      }`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 100 100"
        className={`absolute inset-0 h-full w-full text-seal ${
          spinning ? "animate-seal-turn" : ""
        }`}
        fill="none"
        stroke="currentColor"
      >
        {/* วงนอกเป็นเส้นประ — เวลาหมุนจะเห็นการเคลื่อนไหวชัดกว่าวงทึบ */}
        <circle cx="50" cy="50" r="47" strokeWidth="2.5" strokeDasharray="5 6" />
      </svg>

      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full text-seal"
        fill="none"
        stroke="currentColor"
      >
        <circle cx="50" cy="50" r="38" strokeWidth="1.5" opacity="0.8" />
        {/* เส้นคลื่นแบบตราลบแสตมป์ — ดันออกห่างจากบรรทัดวันที่/เวลาที่อยู่ตรงกลาง
            และหดความยาวลงให้อยู่ในวงในพอดีทุกจุด */}
        <path
          d="M26 29 q6 -4 12 0 t12 0 t12 0 t12 0"
          strokeWidth="1.5"
          opacity="0.55"
        />
        <path
          d="M26 73 q6 -4 12 0 t12 0 t12 0 t12 0"
          strokeWidth="1.5"
          opacity="0.55"
        />
      </svg>

      {postmark && (
        <span className="relative flex flex-col items-center leading-none text-seal">
          <span className="font-display text-[13px] font-semibold sm:text-[15px]">
            {postmark.date}
          </span>
          <span className="mt-1 font-mono text-[10px] tracking-tight sm:text-[11px]">
            {postmark.time}
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * โลโก้ — ซองจดหมายที่ถูกประทับตราแล้วที่มุมขวาล่าง
 *
 * วงตราใช้ fill สีกระดาษเพื่อกลบเส้นซองที่อยู่ข้างใต้ ให้อ่านเป็นสองชั้นจริง
 * จึงต้องวางบนพื้น --color-paper เท่านั้น (ถ้าย้ายไปวางบนพื้นสีอื่น ต้องแก้ fill ตาม)
 * นิ่งเสมอ ไม่มีแอนิเมชัน — ปล่อยให้ตราประทับในการ์ดผลลัพธ์เป็นจุดเดียวที่เคลื่อนไหว
 */
/** หมุดเล็กหน้าหัวกลุ่มสถานที่ในไทม์ไลน์ */
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

function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="7" width="24" height="17" rx="2.5" />
      <path d="M2.4 8.2 L13.5 16.8 L24.6 8.2" />
      <circle
        cx="24.5"
        cy="23.5"
        r="6.2"
        fill="var(--color-paper)"
        strokeDasharray="2.4 2.6"
      />
    </svg>
  );
}

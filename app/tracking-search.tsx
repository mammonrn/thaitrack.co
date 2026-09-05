"use client";

/**
 * ช่องค้นหาพัสดุพร้อมการ์ดผลลัพธ์ — ใช้ร่วมกันทุกหน้าที่ให้ค้นพัสดุได้
 *
 * ------------------------------------------------------------------
 * แยกออกมาจาก app/page.tsx เพื่อให้หน้า landing รายขนส่งใช้ของชิ้นเดียวกัน
 * ไม่ใช่ก๊อปปี้ไปวาง — ถ้าก๊อปปี้ วันที่แก้การแสดงผลของไทม์ไลน์ที่หนึ่ง อีกที่
 * จะเพี้ยนไปเงียบๆ โดยไม่มีใครรู้จนกว่าจะมีคนเปิดเทียบสองหน้าพร้อมกัน
 *
 * ผลพลอยได้ที่สำคัญกว่า: หน้าที่ครอบมันอยู่กลายเป็น server component ได้
 * จึงส่งออก metadata กับ JSON-LD ได้จริง ซึ่งเป็นเงื่อนไขของทั้งงาน SEO
 * ------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from "react";

import ScanButton from "./scan-button";
import SaveOnlyButton from "./save-only-button";
import SaveTrackingButton from "./save-tracking-button";

import type { TrackingResult, TrackingStatus } from "@/lib/carriers/types";
import { markSearchSuccess } from "@/lib/install-invite";
import { NICKNAME_MAX_LENGTH, type SavedTracking } from "@/lib/saved-trackings";
import { translateStatusText } from "@/lib/status-th";
import { groupEventsByLocation } from "@/lib/timeline-groups";
import {
  EMPTY_INPUT_ERROR,
  QUEUED_MESSAGE,
  QUEUED_NOTICE_AFTER_MS,
  SEARCHING_MESSAGE,
  STALE_NOTICE,
  formatPostmark,
  formatStaleSince,
  formatThaiDateTime,
  requestTracking,
  toShipmentFacts,
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

export interface TrackingSearchProps {
  /** หัวข้อใหญ่ของหน้า (H1) */
  title: string;
  /** ประโยคใต้หัวข้อ */
  intro: string;
  /** ข้อความใต้ช่องกรอก เช่นรายชื่อขนส่งที่รองรับ */
  footnote: string;
  /** ตัวอย่างเลขพัสดุใน placeholder — ต่างกันไปตามหน้า */
  placeholder?: string;
  /**
   * ขนส่งที่หน้านี้เจาะจงอยู่ — ส่งไปให้เซิร์ฟเวอร์ใช้เป็นตัวช่วยเดา
   *
   * ⚠️ เป็นแค่ "บริบทของหน้า" ไม่ใช่ข้อเท็จจริงของเลขพัสดุ คนที่เปิดหน้า Flash
   * แล้ววางเลข SPX มีจริงและต้องได้คำตอบที่ถูก ฝั่งเซิร์ฟเวอร์จึงใช้ค่านี้แบบ
   * ระมัดระวัง (ดู app/api/track/route.ts) ไม่ใช่เชื่อทันที
   */
  courierHint?: string;
}

export default function TrackingSearch({
  title,
  intro,
  footnote,
  placeholder = "เช่น EE000000000TH",
  courierHint,
}: TrackingSearchProps) {
  const [trackingNumber, setTrackingNumber] = useState("");
  /**
   * ชื่อ/ข้อความเตือนความจำ — ใช้กับปุ่ม "บันทึกไว้" เท่านั้น
   *
   * ไม่เกี่ยวกับการค้นหาเลยแม้แต่น้อย ปุ่ม "ค้นหาพัสดุ" ไม่เคยอ่านค่านี้
   * (ตั้งใจให้ช่องนี้ว่างได้ตลอด คนที่มาค้นอย่างเดียวไม่ต้องแตะมัน)
   */
  const [nickname, setNickname] = useState("");

  /**
   * กล่องผลการค้นหา — ใช้เลื่อนจอไปหาเมื่อผู้ใช้มาจากลิงก์ ?track=
   *
   * คนที่กดการ์ดจากหน้าประวัติไม่ได้ตั้งใจมาที่ฟอร์ม เขามาดูผล ถ้าปล่อยให้จอ
   * ค้างอยู่บนสุด เขาจะเห็นแต่ช่องกรอกที่มีเลขอยู่แล้ว แล้วต้องเลื่อนหาเอง
   */
  const resultRef = useRef<HTMLElement | null>(null);

  /**
   * true = การค้นหารอบนี้มาจากลิงก์ ไม่ใช่ผู้ใช้พิมพ์เอง
   *
   * ⚠️ แยกสองกรณีนี้โดยตั้งใจ — ตอนผู้ใช้พิมพ์ค้นเอง เขาอยู่ที่ฟอร์มและกำลังมอง
   * มันอยู่ การเลื่อนจอให้เองจะรู้สึกเหมือนหน้ากระตุกหนีมือ
   */
  const cameFromLink = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);
  // มีค่าเมื่อผลที่แสดงอยู่เป็นข้อมูลเก่าจาก cache เพราะระบบขนส่งไม่ตอบ
  const [staleSince, setStaleSince] = useState<string | null>(null);
  /**
   * รูปถ่ายตอนนำจ่าย — มีค่าเฉพาะเมื่อเซิร์ฟเวอร์ตัดสินว่าผู้ใช้คนนี้มีสิทธิ์เห็น
   *
   * ฝั่ง client ไม่ได้ตรวจสิทธิ์อะไรเลยและไม่ควรตรวจ — ถ้าไม่มีสิทธิ์ URL จะไม่
   * ถูกส่งมาตั้งแต่แรก ไม่ใช่ส่งมาแล้วซ่อน (ดู app/api/track/route.ts)
   */
  const [proofPhotoUrls, setProofPhotoUrls] = useState<string[]>([]);
  // รอนานเกินปกติ = คำขอน่าจะติดคิวฝั่งเซิร์ฟเวอร์อยู่ (หรือกำลังถูกลองใหม่ให้)
  // ยังไม่ใช่ความล้มเหลว จึงแค่เปลี่ยนถ้อยคำระหว่างรอ ไม่ขึ้นเป็น error
  const [isQueued, setIsQueued] = useState(false);
  /**
   * ชื่อเล่นที่ผู้ใช้ตั้งไว้ให้พัสดุชิ้นนี้ — "" เมื่อยังไม่ได้ตั้งหรือยังไม่ล็อกอิน
   *
   * ปุ่มบันทึกเป็นคนถามฝั่งเซิร์ฟเวอร์ว่าเลขนี้เคยบันทึกไว้ไหมอยู่แล้ว
   * (มันต้องรู้เพื่อขึ้นปุ่มให้ถูก) จึงรับค่ามาจากตรงนั้นแทนที่จะถามซ้ำเอง
   */
  const [savedNickname, setSavedNickname] = useState("");

  const handleSavedChange = useCallback((saved: SavedTracking | null) => {
    setSavedNickname(saved?.nickname?.trim() ?? "");
  }, []);

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
      setStaleSince(outcome.staleSince);
      setProofPhotoUrls(outcome.proofPhotoUrls);
      // จุดเดียวที่ถือว่า "ผู้ใช้ได้ประโยชน์จากเว็บแล้ว" — การ์ดชวนติดตั้งแอป
      // รอสัญญาณนี้ก่อนถึงจะโผล่ (ดู lib/install-invite.ts)
      markSearchSuccess();
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
    setStaleSince(null);
    setProofPhotoUrls([]);

    applyOutcome(await requestTracking(value, fetch, courierHint));
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
    setStaleSince(null);
    setProofPhotoUrls([]);

    applyOutcome(await requestTracking(trackingNumber, fetch, courierHint));
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
      const outcome = await requestTracking(requested, fetch, courierHint);
      if (!isActive) return;

      cameFromLink.current = true;
      setTrackingNumber(requested);
      applyOutcome(outcome);
    }

    void searchFromLink();

    return () => {
      isActive = false;
    };
    // courierHint มาจาก prop ที่หน้าเป็นคนกำหนดและไม่เปลี่ยนตลอดอายุหน้า
    // effect นี้ตั้งใจให้รันครั้งเดียวตอน mount เท่านั้น (มันล้าง ?track= ทิ้ง
    // หลังใช้ ถ้ารันซ้ำจะไม่มีอะไรให้ทำอยู่แล้ว แต่ก็ไม่ควรผูกให้รันซ้ำได้)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * เลื่อนผลการค้นหาขึ้นมาอยู่บนสุดของจอ — เฉพาะตอนมาจากลิงก์ ?track=
   *
   * ⚠️ รันหลังผลขึ้นแล้วจริง ไม่ใช่ระหว่างโหลด — ผูกกับ [result, error] ซึ่ง
   * เปลี่ยนค่าหลัง render ที่มีเนื้อหาแล้ว ถ้าเลื่อนตอนยังโหลดอยู่ กล่องยังสูง
   * ไม่เท่าเดิม จอจะไปหยุดผิดที่แล้วกระตุกอีกรอบตอนเนื้อหาโผล่
   *
   * เลื่อนทั้งกรณีเจอและไม่เจอ — ผู้ใช้ต้องเห็นผลลัพธ์เสมอ ไม่ว่าผลจะเป็นอะไร
   * การพามาแล้วปล่อยให้หาเองเมื่อค้นไม่เจอ คือการทิ้งเขาไว้ตอนที่สับสนที่สุด
   *
   * เคารพ prefers-reduced-motion — บางคนเวียนหัวกับการเลื่อนแบบนุ่ม ระบบต้อง
   * กระโดดไปเลย ไม่ใช่ค่อยๆ ไถ
   */
  useEffect(() => {
    if (!cameFromLink.current) return;
    if (isLoading) return;
    if (result === null && error === null) return;

    const target = resultRef.current;
    if (target === null) return;

    // ใช้ครั้งเดียวต่อการมาจากลิงก์หนึ่งครั้ง ไม่งั้นการค้นครั้งถัดไปที่ผู้ใช้
    // พิมพ์เองจะโดนเลื่อนตามไปด้วย
    cameFromLink.current = false;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [result, error, isLoading]);

  // timeline โชว์จากล่าสุดไปเก่าสุด (API ส่งมาเรียงจากเก่าไปใหม่)
  // แล้วรวมเหตุการณ์ที่เกิดที่เดียวกันติดกันเข้าเป็นกลุ่ม
  const timelineGroups = groupEventsByLocation(
    result === null ? [] : [...result.events].reverse(),
  );

  // ขนส่งบางเจ้าส่งต้นทาง/ปลายทาง/พนักงานนำจ่ายมาด้วย เจ้าที่ไม่ส่งก็ได้รายการว่าง
  // แล้วแถบนี้จะไม่ขึ้นเลย ไม่ใช่ขึ้นมาแล้วว่างเปล่า
  const shipmentFacts = toShipmentFacts(result?.shipment);

  return (
    <>
    {/* Hero — ช่องกรอกคือพระเอกเพียงอย่างเดียวของโซนนี้ */}
    <section className="px-4 pt-10 pb-8 sm:px-6 sm:pt-16 sm:pb-12">
      <div className="mx-auto w-full max-w-xl text-center">
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[42px]">
          {title}
        </h1>
        {/* สามบรรทัด: เลขพัสดุ · ชื่อ · ปุ่มคู่
            เรียงจาก "สิ่งที่ต้องกรอกแน่ๆ" ลงมาหา "สิ่งที่จะทำกับมัน" */}
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-2.5 sm:mt-8">
          <label htmlFor="tracking-number" className="sr-only">
            เลขพัสดุ
          </label>
          {/* relative เพื่อวางปุ่มกล้องซ้อนมุมขวาของช่องกรอก */}
          <div className="relative">
          <input
            id="tracking-number"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
            placeholder={placeholder}
            // เว้นที่ด้านขวาให้ปุ่มกล้อง ไม่ให้ตัวอักษรวิ่งไปทับ
            className="h-14 w-full rounded-xl border border-line-strong bg-white pl-4 pr-14 text-center font-body text-base text-body outline-none transition-colors placeholder:text-faint/70 hover:border-ink/30 focus:border-ink sm:h-15 sm:pl-5 sm:text-left sm:text-lg"
          />
          <ScanButton onDetected={(value) => void runSearchFromScan(value)} />
          </div>
          {/* ช่องตั้งชื่อ — ของเสริมสำหรับคนที่จะบันทึก ไม่ใช่สิ่งที่คนมาค้นหา
              ต้องกรอก · เว้นว่างได้ตลอด แล้วประวัติจะใช้เลขพัสดุเป็นชื่อแทน
              (ดู displayTitleOf ใน lib/saved-trackings.ts) */}
          <label htmlFor="tracking-nickname" className="sr-only">
            ตั้งชื่อหรือข้อความเตือนความจำ
          </label>
          <input
            id="tracking-nickname"
            type="text"
            autoComplete="off"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            maxLength={NICKNAME_MAX_LENGTH}
            placeholder="ตั้งชื่อไว้กันลืม เช่น รองเท้า, ของฝากแม่ (ไม่ใส่ก็ได้)"
            className="h-12 w-full rounded-xl border border-line-strong bg-white px-4 text-center font-body text-sm text-body outline-none transition-colors placeholder:text-faint/70 hover:border-ink/30 focus:border-ink sm:text-left"
          />

          {/* ปุ่มคู่บรรทัดเดียวกัน กว้างครึ่งต่อครึ่ง
              ⚠️ "ค้นหาพัสดุ" ต้องเด่นกว่าเสมอ (พื้นทึบ) ส่วน "บันทึกไว้" เป็น
              ขอบโปร่ง — คนส่วนใหญ่มาเพื่อค้น ไม่ใช่บันทึก ถ้าสองปุ่มเด่นเท่ากัน
              ผู้ใช้ต้องหยุดคิดว่าจะกดอันไหน ทั้งที่คำตอบชัดอยู่แล้ว

              flex-wrap + basis กว้างพอ: จอแคบมาก (320px) ปุ่มจะตกลงมาซ้อนกัน
              เต็มความกว้างแทนที่จะบีบจนตัวหนังสือขึ้นบรรทัดใหม่หรือล้นออกนอกปุ่ม */}
          <div className="flex flex-wrap gap-2.5">
            <button
              type="submit"
              disabled={isLoading}
              className="h-14 min-w-[9rem] flex-1 basis-40 rounded-xl bg-ink px-4 font-display text-base font-semibold text-white transition-colors hover:bg-ink-strong disabled:cursor-not-allowed disabled:bg-ink-busy sm:h-15 sm:text-lg"
            >
              {isLoading ? "กำลังค้นหา…" : "ค้นหาพัสดุ"}
            </button>

            <SaveOnlyButton
              trackingNumber={trackingNumber}
              nickname={nickname}
              onSaved={() => setNickname("")}
            />
          </div>
        </form>

        <p className="mt-4 text-xs leading-relaxed text-faint sm:mt-5 sm:text-sm">
          {footnote}
        </p>
      </div>
    </section>

    {/* ผลการค้นหา */}
    {/* จอใหญ่ให้การ์ดผลลัพธ์กว้างกว่า hero เล็กน้อย ไม่ให้ดูลอยกลางจอโล่งๆ */}
    <section
      ref={resultRef}
      // scroll-mt เผื่อระยะไว้ด้านบนเล็กน้อย ไม่ให้ขอบการ์ดชนขอบจอพอดีจนดูอึดอัด
      className="mx-auto w-full max-w-xl scroll-mt-4 px-4 pb-12 sm:max-w-2xl sm:px-6 sm:pb-16"
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
          {/* ป้ายข้อมูลเก่า — ขึ้นเฉพาะตอนระบบขนส่งไม่ตอบแล้วเราหยิบของเก่า
              จาก cache มาแสดงแทน วางไว้เหนือหัวการ์ดเพื่อให้อ่านเจอก่อน
              สถานะ ไม่งั้นผู้ใช้จะเชื่อว่าสถานะที่เห็นเป็นข้อมูลสด

              ใช้พื้นกระดาษกับเส้นคั่นตามธีม ไม่ใช้สีแดงของ error เพราะนี่คือ
              คำตอบที่ใช้ได้ เพียงแต่ไม่สด — ไม่ใช่ความล้มเหลว */}
          {staleSince !== null && (
            <div className="border-b border-line bg-paper px-5 py-3.5 sm:px-6">
              <p className="font-display text-sm font-semibold text-ink">
                {STALE_NOTICE.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-faint sm:text-sm">
                {STALE_NOTICE.detail}
              </p>
              {formatStaleSince(staleSince) && (
                <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-faint sm:text-xs">
                  {formatStaleSince(staleSince)}
                </p>
              )}
            </div>
          )}

          {/* หัวการ์ด: ตราประทับ + สถานะปัจจุบัน + ปุ่มบันทึก
              จอแคบให้ตราประทับกับปุ่มบันทึกอยู่แถวบน แล้วข้อความสถานะตกลงมา
              แถวล่างเต็มความกว้าง (order-* สลับลำดับให้จอกว้างเรียงเป็นแถวเดียว)
              ปุ่มบันทึกอยู่บนสุดเพื่อให้เห็นทันทีโดยไม่ต้องเลื่อนผ่านไทม์ไลน์ */}
          <div className="flex flex-wrap items-center gap-3 p-5 sm:flex-nowrap sm:gap-6 sm:p-6">
            <div className="order-1">
              <Postmark postmark={formatPostmark(result.lastUpdated)} />
            </div>

            <div className="order-2 ml-auto sm:order-3 sm:ml-0">
              <SaveTrackingButton
                trackingNumber={result.trackingNumber}
                onSavedChange={handleSavedChange}
              />
            </div>

            <div className="order-3 min-w-0 basis-full sm:order-2 sm:flex-1 sm:basis-auto">
              {/* ชื่อที่ผู้ใช้ตั้งเองมีความหมายกับเขามากกว่าเลข 15 หลัก
                  จึงขึ้นก่อน แล้วลดเลขพัสดุเป็นบรรทัดรอง — ลำดับเดียวกับ
                  การ์ดในหน้าประวัติ จะได้เป็นของสิ่งเดียวกันในสายตาผู้ใช้

                  แต่ยังเล็กกว่าข้อความสถานะอยู่หนึ่งขั้น เพราะคำถามที่หน้า
                  นี้ต้องตอบให้เร็วที่สุดคือ "พัสดุถึงไหนแล้ว" ไม่ใช่
                  "พัสดุชิ้นไหน" (ดู DESIGN.md) */}
              {savedNickname === "" ? (
                <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint sm:text-xs">
                  {result.trackingNumber}
                </h2>
              ) : (
                <>
                  <h2 className="font-display text-base font-semibold leading-snug text-ink sm:text-lg">
                    {savedNickname}
                  </h2>
                  <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-faint sm:text-xs">
                    {result.trackingNumber}
                  </p>
                </>
              )}
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

          {/* รายละเอียดการจัดส่ง — ขึ้นเฉพาะเจ้าที่ส่งข้อมูลพวกนี้มาจริง
              วางคั่นระหว่างหัวการ์ดกับไทม์ไลน์ เพราะเป็นข้อมูลของ "พัสดุชิ้นนี้"
              ไม่ใช่ของเหตุการณ์ใดเหตุการณ์หนึ่ง

              ชื่อผู้รับกับผู้เซ็นรับที่อยู่ในนี้ถูกปิดบังบางส่วนมาตั้งแต่ adapter
              แล้ว (ดู lib/mask-name.ts) เพราะใครที่เห็นเลขพัสดุก็ค้นได้โดย
              ไม่ต้องพิสูจน์ตัวตน ค่าเต็มจึงไม่เคยเดินทางมาถึงเบราว์เซอร์ */}
          {shipmentFacts.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line bg-paper/60 px-5 py-4 sm:grid-cols-3 sm:px-6">
              {shipmentFacts.map((fact) => (
                <div key={fact.label} className="min-w-0">
                  <dt className="text-[11px] font-medium tracking-[0.04em] text-faint sm:text-xs">
                    {fact.label}
                  </dt>
                  <dd className="mt-0.5 truncate text-sm font-medium text-body sm:text-base">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {/* รูปถ่ายตอนนำจ่าย — เห็นเฉพาะคนที่บันทึกพัสดุนี้ไว้ก่อนของถึงมือ
              (ดู lib/proof-access.ts) เซิร์ฟเวอร์เป็นคนตัดสินสิทธิ์และไม่ส่ง
              URL มาให้เลยถ้าไม่ผ่านเกณฑ์ ตรงนี้จึงไม่มีเงื่อนไขเรื่องสิทธิ์
              ให้ตรวจซ้ำ — มี URL = มีสิทธิ์ */}
          {proofPhotoUrls.length > 0 && (
            <div className="border-t border-line bg-paper/60 p-5 sm:p-6">
              <h3 className="font-display text-sm font-semibold text-ink">
                รูปถ่ายตอนนำจ่าย
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-faint">
                เห็นได้เฉพาะคุณ เพราะบันทึกพัสดุชิ้นนี้ไว้ก่อนของถึงมือผู้รับ
              </p>

              {/* ขนส่งบางเจ้าส่งมาหลายรูป (J&T: รูปพัสดุ + รูปลายเซ็น)
                  วางเรียงกันแทนที่จะเลือกมาแสดงรูปเดียว เพราะเราไม่รู้ว่า
                  รูปไหนคือรูปที่ผู้ใช้อยากเห็น */}
              <div className="mt-3 flex flex-col gap-3">
                {proofPhotoUrls.map((url, index) => (
                  /* eslint-disable-next-line @next/next/no-img-element --
                     รูปมาจากเซิร์ฟเวอร์ของขนส่ง next/image จะต้องตั้ง
                     remotePatterns ให้ทุกเจ้าที่รองรับ ซึ่งเปลี่ยนได้ตลอด
                     และไม่ได้ช่วยอะไรกับรูปที่แสดงครั้งเดียว */
                  <img
                    key={url}
                    src={url}
                    alt={
                      proofPhotoUrls.length === 1
                        ? "รูปถ่ายที่ขนส่งบันทึกไว้ตอนนำจ่ายพัสดุชิ้นนี้"
                        : `รูปถ่ายที่ขนส่งบันทึกไว้ตอนนำจ่ายพัสดุชิ้นนี้ รูปที่ ${index + 1} จาก ${proofPhotoUrls.length}`
                    }
                    loading="lazy"
                    className="block max-h-96 w-full rounded-xl border border-line object-contain"
                  />
                ))}
              </div>
            </div>
          )}

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
    </>
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

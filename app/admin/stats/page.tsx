/**
 * /admin/stats — หน้าสถิติรวมของระบบ
 *
 * ⚠️ ตรวจสิทธิ์ด้วยด่านชุดเดียวกับ /admin/branches ก่อน render อะไรทั้งสิ้น
 * ถ้าไม่ผ่านตอบ 404 (เหตุผลของการเลือก 404 อยู่ที่ ../branches/page.tsx)
 *
 * ------------------------------------------------------------------
 * ⚠️ ข้อบังคับด้านความเป็นส่วนตัวของหน้านี้
 *
 * **ตัวเลขรวมเท่านั้น** ห้ามแสดงอีเมล ชื่อ เลขพัสดุ หรืออะไรก็ตามที่ทำให้
 * รู้ว่าผู้ใช้คนไหนค้นอะไร ไม่ว่าจะโดยตรงหรือโดยการเอาสองตัวเลขมาไล่เทียบกัน
 *
 * ทุกตัวเลขในหน้านี้มาจากฟังก์ชันที่คืน count(*) หรือ jsonb ของ count(*)
 * เท่านั้น ไม่มีทางไหนที่คืนแถวดิบออกมาได้เลย (ดู lib/supabase/search-events.ts
 * และ supabase/migrations/0007_search_events.sql)
 *
 * มีเทสต์เฝ้ากติกานี้อยู่ที่ lib/admin-privacy.test.ts ซึ่งอ่านซอร์สจริง
 * ------------------------------------------------------------------
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import ExportButton from "./export-button";
import SettingsToggle from "./settings-toggle";

import {
  currentPeriodKey,
  loadProviderUsage,
  nextResetOf,
  PROVIDER_IDS,
  PROVIDER_LABEL,
  readHarvestReserve,
  readLeanRatio,
  readQuota,
} from "@/lib/provider-usage";
import { SETTING_KEYS } from "@/lib/app-settings";
import type { ReportData } from "@/lib/admin-report";
import { requireAdmin } from "@/lib/supabase/admin-guard";
import { readSettings } from "@/lib/supabase/app-settings";
import { countBranches } from "@/lib/supabase/locations";
import { listProviderUsage } from "@/lib/supabase/provider-usage";
import { readReferrerChannels } from "@/lib/supabase/referrer";
import {
  REFERRER_LONG_DAYS,
  REFERRER_SHORT_DAYS,
  WINDOW_OPTIONS,
  readWindowDays,
} from "@/lib/admin-window";
import { standingQuotaWarnings } from "@/lib/health-check";
import { MAX_IMAGES, mapCacheStats } from "@/lib/map-cache";
import {
  readErrorBreakdown,
  readInstallPromptStats,
  readInstallStats,
  readLatency,
  readLatencyGaps,
  readMemberActivity,
  readMemberStats,
  readSearchDaily,
  readSearchEfficiency,
  readSearchOverview,
  readTopCarriers,
  readUnfoundShapes,
  readUnknownCourierFailures,
} from "@/lib/supabase/search-events";

/** ต้องรันบน Node.js runtime และห้าม cache — ตัวเลขเปลี่ยนตลอดเวลา */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOP_CARRIER_LIMIT = 8;
const UNFOUND_SHAPE_LIMIT = 12;

/** จำนวนแบบอ่านง่าย เช่น 12,345 */
const count = (value: number) => value.toLocaleString("th-TH");

/** ชื่อไทยของช่องทางที่มา */
const REFERRER_LABEL: Record<string, string> = {
  google: "Google",
  facebook: "Facebook",
  tiktok: "TikTok",
  line: "LINE",
  instagram: "Instagram",
  direct: "มาตรงๆ",
  other: "อื่นๆ",
};

/** ชื่อไทยของชั้นที่ตอบคำค้น */
const SOURCE_LABEL: Record<string, string> = {
  memory: "cache ใน memory",
  supabase: "cache ถาวร",
  api: "ยิงถามขนส่งจริง",
  error: "ตอบไม่ได้",
};

/** สัดส่วนเป็นเปอร์เซ็นต์ — "—" เมื่อยังไม่มีข้อมูลให้หาร */
function percent(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

interface TileProps {
  label: string;
  value: string;
  hint?: string;
}

/** การ์ดตัวเลขหนึ่งใบ */
function Tile({ label, value, hint }: TileProps) {
  return (
    <div className="rounded-xl border border-line bg-white/60 p-4">
      <p className="text-xs text-faint">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">
        {value}
      </p>
      {hint === undefined ? null : (
        <p className="mt-1 font-mono text-[11px] text-faint">{hint}</p>
      )}
    </div>
  );
}

interface QuotaTileProps {
  label: string;
  used: number;
  quota: number;
  /** โควตาที่สงวนไว้ให้การเก็บที่อยู่สาขา — 0 เมื่อไม่ได้สงวน */
  reserve: number;
  /** เวลาที่รอบถัดไปเริ่ม — null เมื่อรอบนี้ไม่มีวันรีเซ็ต */
  resetAt: number | null;
  /** ใช้เกินสัดส่วนนี้แล้วเปลี่ยนเป็นสีเตือน (0–1) */
  warnAt: number;
}

/**
 * การ์ดโควตาหนึ่งเจ้า — เปลี่ยนสีเมื่อใช้เกินเกณฑ์
 *
 * ใช้สีชาดซึ่งเป็นสีเดียวในเว็บที่ไม่ใช่น้ำเงิน/กระดาษ (ดู DESIGN.md) เพราะ
 * นี่คือสิ่งเดียวบนหน้านี้ที่ต้อง "เห็นแล้วรีบทำอะไรสักอย่าง" ไม่ใช่ตัวเลข
 * ที่อ่านเอาความรู้
 */
function QuotaTile({
  label,
  used,
  quota,
  reserve,
  resetAt,
  warnAt,
}: QuotaTileProps) {
  const ratio = quota > 0 ? used / quota : 0;
  const warning = ratio >= warnAt;

  // ไม่มีวันรีเซ็ต = ใช้หมดแล้วหมดเลย ต้องบอกให้ชัดกว่าการเว้นว่างไว้
  const reset =
    resetAt === null
      ? "ไม่รีเซ็ต — ใช้หมดแล้วหมดเลย"
      : `รีเซ็ต ${formatResetDate(resetAt)}`;

  return (
    <div
      className={`rounded-xl border p-4 ${
        warning ? "border-seal/40 bg-seal/5" : "border-line bg-white/60"
      }`}
    >
      <p className="text-xs text-faint">{label}</p>
      <p
        className={`mt-1 font-display text-2xl font-bold tracking-tight ${
          warning ? "text-seal" : "text-ink"
        }`}
      >
        {count(used)} / {count(quota)}
      </p>
      <p className="mt-1 font-mono text-[11px] text-faint">
        {percent(used, quota)} · {reset}
      </p>
      {reserve > 0 && (
        <p className="mt-1 text-[11px] leading-snug text-faint">
          กัน {count(reserve)} ครั้งสุดท้ายไว้ให้การเก็บที่อยู่สาขาเท่านั้น
          การค้นหาทั่วไปใช้ได้ถึง {count(quota - reserve)}
        </p>
      )}
    </div>
  );
}

/** "5 ก.ย. 2569 00:00" — เวลาไทยเสมอ เพราะรอบบิลนับตามเวลาไทย */
function formatResetDate(at: number): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeZone: "Asia/Bangkok",
  }).format(at);
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
      {note === undefined ? null : (
        <p className="mt-1 text-xs text-faint">{note}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function AdminStatsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    console.warn(`[admin] ปฏิเสธการเปิดหน้าสถิติ: ${admin.reason}`);
    notFound();
  }

  // รอบบิลของแต่ละเจ้าไม่ตรงกัน จึงต้องถามยอดด้วยคีย์รอบของเจ้านั้นๆ
  // (รายวัน / รายเดือนตามวันที่ซื้อ / ไม่รีเซ็ตเลย — ดู lib/billing-period.ts)
  // ปล่อยให้ตัวช่วยอ่านเวลาปัจจุบันเอง — การเรียก Date.now() ตรงๆ ใน component
  // เป็นการอ่านค่าที่เปลี่ยนตลอดระหว่าง render ซึ่ง eslint ห้ามไว้ด้วยเหตุผลนั้น
  const periods = Object.fromEntries(
    PROVIDER_IDS.map((provider) => [provider, currentPeriodKey(provider)]),
  );

  // ช่วงเวลาที่ผู้ใช้เลือก — ติดไปกับ URL เพื่อให้ refresh แล้วไม่หาย และส่ง
  // ลิงก์ให้กันดูตัวเลขชุดเดียวกันได้
  const windowDays = readWindowDays((await props.searchParams).days);
  const leanRatio = readLeanRatio();

  // ⚠️ ต้องอ่านยอดโควตาของจริงก่อน — ตัวนับใน memory เป็นศูนย์หลัง restart ทุกครั้ง
  // ถ้าไม่อ่าน แถบเตือนข้างล่างจะเงียบสนิทเสมอหลัง deploy ซึ่งเป็นความพังแบบที่
  // ไม่มีอะไรฟ้อง (เจอตอนทดสอบจริง: แถบไม่ขึ้นทั้งที่งบค้นหาหมดไปแล้ว)
  await loadProviderUsage();

  // เจ้าที่ใกล้ชนเพดานและโควตาไม่มีวันรีเซ็ต — กลุ่มที่ monitor ไม่มีทางเตือนได้
  // (ดู app/api/health/quota/route.ts) หน้านี้จึงเป็นที่เดียวที่บอกได้
  const standingQuota = standingQuotaWarnings();

  // ⚠️ อ่านจากหน่วยความจำของโปรเซสนี้ ไม่ใช่ฐานข้อมูล — เป็นยอดตั้งแต่ deploy
  // ล่าสุด และจะเป็น 0 ทั้งหมดทันทีหลัง restart ซึ่งถูกต้องตามธรรมชาติของมัน
  const mapCache = mapCacheStats();

  const [
    members,
    activity,
    allTime,
    recent,
    daily,
    carriers,
    branches,
    usage,
    errors,
    latency,
    latencyGaps,
    installs,
    unknownCourier,
    invite,
    unfoundShapes,
    referrers7d,
    referrers30d,
    efficiency,
    settings,
  ] = await Promise.all([
    readMemberStats(),
    readMemberActivity(),
    readSearchOverview(0),
    readSearchOverview(windowDays),
    readSearchDaily(windowDays),
    readTopCarriers(windowDays, TOP_CARRIER_LIMIT),
    countBranches(),
    listProviderUsage(periods),
    readErrorBreakdown(windowDays),
    readLatency(windowDays),
    readLatencyGaps(windowDays),
    readInstallStats(),
    readUnknownCourierFailures(windowDays),
    readInstallPromptStats(windowDays),
    readUnfoundShapes(windowDays, UNFOUND_SHAPE_LIMIT),
    readReferrerChannels(REFERRER_SHORT_DAYS),
    readReferrerChannels(REFERRER_LONG_DAYS),
    readSearchEfficiency(windowDays),
    // อ่านค่าจริงจากฐานข้อมูลตรงๆ ไม่ผ่าน cache — หน้าแอดมินต้องเห็นสถานะ
    // ปัจจุบันเสมอ ไม่ใช่ค่าที่ค้างอยู่ในชั้น cache ของเส้นทางแสดงผล
    // (เส้นทางนั้นใช้ readCachedSettings ดู lib/settings-cache.ts)
    readSettings(),
  ]);

  // เรียงตามยอด 30 วันเพื่อให้ลำดับนิ่ง ไม่กระโดดไปมาตามความผันผวนของ 7 วัน
  const referrerRows = referrers30d.map((row) => ({
    channel: row.channel,
    last7d: referrers7d.find((item) => item.channel === row.channel)?.total ?? 0,
    last30d: row.total,
  }));
  const referrerTotal30d = referrers30d.reduce((sum, row) => sum + row.total, 0);

  const answered = recent.found + recent.notFound;
  const cacheable = recent.fromCache + recent.fromApi;
  const busiestDay = daily.reduce((most, day) => Math.max(most, day.total), 0);
  const carrierPeak = carriers.reduce((most, row) => Math.max(most, row.total), 0);

  const usageByProvider = new Map(usage.map((row) => [row.provider, row]));

  // ยอดที่ยิง API จริงรวมทั้งช่วง — ใช้บอกว่า cache ช่วยประหยัดไปเท่าไร
  const efficiencyTotals = efficiency.reduce(
    (sum, row) => ({
      total: sum.total + row.total,
      fromApi: sum.fromApi + row.fromApi,
      fromCache: sum.fromCache + row.fromCache,
    }),
    { total: 0, fromApi: 0, fromCache: 0 },
  );
  const efficiencyPeak = efficiency.reduce(
    (most, row) => Math.max(most, row.total),
    0,
  );

  /**
   * ก้อนข้อมูลสำหรับปุ่ม export — ประกอบจากตัวแปรเดียวกับที่ render บนหน้า
   *
   * ⚠️ ตัวเลขรวมล้วนทั้งหมด ไม่มีฟิลด์ไหนที่ระบุตัวบุคคลได้ (ข้อบังคับเดียวกับ
   * ทั้งหน้า) ถ้าจะเพิ่มฟิลด์ ต้องผ่านข้อบังคับนั้นก่อนเสมอ
   */
  const report: ReportData = {
    generatedAt: new Date().toISOString(),
    windowDays,
    members: {
      total: members.total,
      new7d: members.new7d,
      new30d: members.new30d,
    },
    activity: {
      active7d: activity.active7d,
      activePrev7d: activity.activePrev7d,
      returned: activity.returned,
      saves7d: activity.saves7d,
    },
    searchAllTime: {
      total: allTime.total,
      found: allTime.found,
      notFound: allTime.notFound,
      error: allTime.error,
    },
    searchWindow: {
      total: recent.total,
      found: recent.found,
      notFound: recent.notFound,
      notFoundCached: recent.notFoundCached,
      error: recent.error,
      fromCache: recent.fromCache,
      fromApi: recent.fromApi,
      stale: recent.stale,
    },
    efficiency: efficiency.map((row) => ({
      day: row.day,
      total: row.total,
      fromApi: row.fromApi,
      fromCache: row.fromCache,
      failed: row.failed,
    })),
    carriers: carriers.map((row) => ({
      carrierCode: row.carrierCode,
      total: row.total,
    })),
    errors: errors.map((row) => ({
      reason: row.reason,
      upstreamCode: row.upstreamCode,
      total: row.total,
    })),
    latency: latency.map((row) => ({
      source: row.source,
      label: SOURCE_LABEL[row.source] ?? row.source,
      p50Ms: row.p50Ms,
      p95Ms: row.p95Ms,
      total: row.total,
    })),
    unfoundShapes: unfoundShapes.map((row) => ({
      shape: row.shape,
      total: row.total,
    })),
    unknownCourierFailures: unknownCourier,
    quotas: PROVIDER_IDS.map((provider) => ({
      provider,
      label: PROVIDER_LABEL[provider],
      used: usageByProvider.get(provider)?.callCount ?? 0,
      quota: readQuota(provider),
      reserve: readHarvestReserve(provider),
      period: periods[provider],
    })),
    branches: { known: branches.known, unknown: branches.unknown },
    installs: {
      total: installs.total,
      last7d: installs.last7d,
      last30d: installs.last30d,
    },
    invite: {
      shown: invite.shown,
      clicked: invite.clicked,
      dismissed: invite.dismissed,
    },
    referrers: referrerRows,
    settings: Object.fromEntries(
      SETTING_KEYS.map((key) => [key, settings[key]]),
    ),
  };

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
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
            แอดมิน
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          สถิติระบบ
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-faint">
          ตัวเลขรวมทั้งระบบเท่านั้น หน้านี้และ API เบื้องหลังไม่มีทางบอกได้ว่า
          ผู้ใช้คนไหนค้นพัสดุอะไร — สถิติการค้นถูกเก็บแบบไม่ผูกกับบัญชีผู้ใช้
          และไม่มีการเก็บเลขพัสดุไว้เลย
        </p>
        <p className="mt-1 font-mono text-[11px] text-faint">
          เข้าสู่ระบบเป็น {admin.email} · ช่วงที่แสดง {windowDays} วันล่าสุด
        </p>

        {/* ปุ่มเลือกช่วงเวลา
            ⚠️ เป็นลิงก์ ไม่ใช่ปุ่ม client ที่ setState — ค่าที่เลือกต้องอยู่ใน
            URL เพื่อให้ refresh แล้วไม่หาย และส่งลิงก์ให้คนอื่นดูตัวเลขชุด
            เดียวกันได้ · แลกมาด้วยการโหลดหน้าใหม่ ซึ่งยอมรับได้บนหน้าแอดมิน

            มีเพราะรายงาน 30 วันกลบผลของสิ่งที่เพิ่ง deploy ไปเมื่อวาน —
            ข้อมูลเก่าในหน้าต่างเดียวกันดึงค่าเฉลี่ยไว้จนมองไม่เห็นความเปลี่ยนแปลง */}
        <nav
          aria-label="ช่วงเวลาที่แสดง"
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          {WINDOW_OPTIONS.map((option) => {
            const active = option === windowDays;
            return (
              <Link
                key={option}
                href={`/admin/stats?days=${option}`}
                aria-current={active ? "page" : undefined}
                className={
                  "min-h-9 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors " +
                  (active
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-white text-faint hover:border-ink hover:text-ink")
                }
              >
                {option} วัน
              </Link>
            );
          })}
          <span className="text-[11px] text-faint">
            ยอดสะสมตลอดกาล โควตา และตารางช่องทางเข้าเว็บ ไม่ขึ้นกับปุ่มนี้
          </span>
        </nav>

        {/* ไฟล์ถูกสร้างในเบราว์เซอร์ตอนกด ไม่เก็บไว้ที่ไหน และมีแต่ตัวเลขรวม
            เหมือนที่แสดงบนหน้านี้ทุกประการ (ดู lib/admin-report.ts) */}
        <div className="mt-4">
          <ExportButton data={report} />
        </div>

        <div className="mt-8 flex flex-col gap-10">
          {/* วางไว้บนสุดเพราะเป็นสิ่งเดียวบนหน้านี้ที่กดแล้วเปลี่ยนสิ่งที่ผู้ใช้
              เห็นทันที ส่วนที่เหลือเป็นตัวเลขไว้อ่าน */}
          <Section
            title="สวิตช์ระบบ"
            note="มีผลกับผู้ใช้ทุกคนทันที ไม่ต้อง deploy ใหม่ · ค่าถูก cache ไว้ 1 นาที แต่การกดปุ่มล้าง cache ให้เองทันที"
          >
            <SettingsToggle settings={settings} />
          </Section>

          <Section title="สมาชิก">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Tile label="สมาชิกทั้งหมด" value={count(members.total)} />
              <Tile label="สมัครใหม่ 7 วัน" value={count(members.new7d)} />
              <Tile label="สมัครใหม่ 30 วัน" value={count(members.new30d)} />
            </div>
          </Section>

          <Section
            title="การกลับมาใช้ซ้ำ"
            note="วัดจากการบันทึกพัสดุ ไม่ใช่การค้นหา — ระบบไม่เก็บว่าใครค้นอะไร ตัวเลขจึงต่ำกว่าความจริงเสมอ"
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile
                label="สมาชิกที่บันทึกพัสดุ 7 วัน"
                value={count(activity.active7d)}
              />
              <Tile
                label="กลับมาสัปดาห์ถัดไป"
                value={percent(activity.returned, activity.activePrev7d)}
                hint={`${count(activity.returned)} จาก ${count(activity.activePrev7d)} คน`}
              />
              <Tile
                label="บันทึกเฉลี่ยต่อคน"
                value={
                  activity.active7d === 0
                    ? "—"
                    : (activity.saves7d / activity.active7d).toFixed(1)
                }
                hint={`บันทึกรวม ${count(activity.saves7d)} ครั้ง`}
              />
              <Tile
                label="ค้นหาต่อสมาชิก"
                value={
                  members.total === 0
                    ? "—"
                    : (recent.total / members.total).toFixed(1)
                }
                hint={`${windowDays} วัน · รวมคนที่ไม่ได้ล็อกอินด้วย`}
              />
            </div>
          </Section>

          <Section
            title="การค้นหา"
            note={`ยอดสะสมทั้งหมด ${count(allTime.total)} ครั้ง`}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label={`ค้นหา ${windowDays} วัน`} value={count(recent.total)} />
              <Tile
                label="ค้นเจอ"
                value={percent(recent.found, answered)}
                hint={`${count(recent.found)} ครั้ง`}
              />
              <Tile
                label="ค้นไม่เจอ"
                value={percent(recent.notFound, answered)}
                hint={
                  // แยกให้เห็นว่าในจำนวนนี้กี่ครั้งที่ตอบจากความจำโดยไม่ยิงขนส่ง
                  // — เป็นตัวเลขเดียวที่บอกได้ว่า cache ของคำตอบ "ไม่พบ"
                  // ช่วยได้จริงแค่ไหน (ดู lib/not-found-cache.ts)
                  recent.notFoundCached === 0
                    ? `${count(recent.notFound)} ครั้ง`
                    : `${count(recent.notFound)} ครั้ง · ตอบจาก cache ${count(recent.notFoundCached)}`
                }
              />
              <Tile
                label="cache hit rate"
                value={percent(recent.fromCache, cacheable)}
                hint={`ยิง API จริง ${count(recent.fromApi)} ครั้ง`}
              />
            </div>

            {recent.error > 0 || recent.stale > 0 ? (
              <p className="mt-3 text-xs text-faint">
                ระบบขัดข้อง {count(recent.error)} ครั้ง · แสดงข้อมูลเก่าแทน{" "}
                {count(recent.stale)} ครั้ง
              </p>
            ) : null}
          </Section>

          <Section
            title="สาเหตุที่ตอบไม่ได้"
            note="รวมทั้งที่ค้นไม่เจอและที่ระบบขัดข้อง — ไม่ต้องไปงมใน log อีก"
          >
            {unknownCourier > 0 ? (
              <p className="mb-4 rounded-xl border border-line bg-white/60 p-4 text-xs leading-relaxed text-faint">
                <span className="font-mono text-ink">
                  {count(unknownCourier)} ครั้ง
                </span>{" "}
                ในจำนวนนี้ล้มตอนที่เหลือผู้ให้บริการเจ้าเดียว เพราะเดาไม่ออกว่า
                เลขนั้นเป็นขนส่งเจ้าไหน (เลขทรง TH… ใช้ร่วมกันระหว่าง SPX กับ
                Flash และยังไม่เคยค้นเลขนั้นสำเร็จมาก่อน) ETrackings จึงถูกตัด
                ออกจากลำดับตั้งแต่ต้น
                <br />
                นับเป็นรายคำขอ ไม่ใช่รายเลขพัสดุ — เลขเดิมที่ค้นซ้ำถูกนับซ้ำ
                เพราะเราไม่ได้เก็บเลขพัสดุไว้ ตัวเลขนี้จึงเป็นเพดานบน
              </p>
            ) : null}

            {errors.length === 0 ? (
              <Empty>ยังไม่มีคำขอที่ตอบไม่ได้ในช่วงนี้</Empty>
            ) : (
              <ul className="flex flex-col gap-1">
                {errors.map((row) => (
                  <li
                    key={`${row.reason}:${row.upstreamCode ?? "-"}`}
                    className="flex items-center gap-3 border-b border-line py-1.5 last:border-0"
                  >
                    <span className="font-mono text-[11px] text-ink">
                      {row.reason}
                    </span>
                    {row.upstreamCode === null ? null : (
                      <span className="font-mono text-[11px] text-faint">
                        {row.upstreamCode}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-faint">
                      {count(row.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="ความเร็ว"
            note="p95 สำคัญกว่า p50 — ค่ากลางบอกว่าปกติเร็วแค่ไหน แต่ที่ผู้ใช้จำได้คือครั้งที่ช้า"
          >
            {latency.length === 0 ? (
              <Empty>ยังไม่มีข้อมูลความเร็ว</Empty>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {latency.map((row) => (
                  <Tile
                    key={row.source}
                    label={SOURCE_LABEL[row.source] ?? row.source}
                    value={`${count(row.p95Ms)} ms`}
                    hint={`p50 ${count(row.p50Ms)} ms · ${count(row.total)} ครั้ง`}
                  />
                ))}
              </div>
            )}

            {/* ⚠️ ตารางนี้นับได้น้อยกว่าตารางอื่นบนหน้าเดียวกัน เพราะ admin_latency
                กรอง took_ms is not null ออก ส่วนตารางอื่นไม่กรอง · ของจริงที่เจอ:
                "สาเหตุที่ตอบไม่ได้" นับได้ 172 แต่ชั้น error ตรงนี้นับได้ 170
                แล้วไม่มีอะไรบนหน้าอธิบายเลย คนอ่านต้องเดาเองว่าตัวไหนผิด

                ตั้งใจไม่ยัด 0 ให้แถวที่ไม่มีค่าเวลา เพราะจะทำให้ p50 เพี้ยนทันที —
                บอกจำนวนที่นับไม่ได้ตรงๆ ดีกว่า

                ⚠️ ตัวเลขนี้นับ **ทุกชั้น** ไม่ใช่เฉพาะชั้น error จึงห้ามเขียนว่า
                "ต่างกันเท่านี้พอดี" กับตารางใดตารางหนึ่ง (เคยเขียนแบบนั้นแล้วผิด:
                ยอดรวมคือ 19 แต่ส่วนที่อธิบาย 172-vs-170 มีแค่ 2)

                N มาจากการนับจริง ไม่ใช่ค่าคงที่ เพราะแถวพวกนี้จะทยอยหลุดหน้าต่าง
                เวลาไปเอง — เลือก 1 วันตอนนี้ก็ไม่เหลือแล้ว */}
            {latencyGaps > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-faint">
                ไม่รวม {count(latencyGaps)} ครั้งที่ไม่มีค่าเวลาบันทึกไว้
                (แถวยุคแรกก่อนระบบเก็บเวลาครบทุกเส้นทาง) ช่อง “จำนวน”
                ในตารางนี้จึงน้อยกว่าตารางอื่นบนหน้านี้เล็กน้อย
              </p>
            )}
          </Section>

          <Section
            title="ค้นหา เทียบ โควตาที่ใช้จริง"
            note="แท่งเต็ม = ค้นหาทั้งหมด · ส่วนเข้ม = ที่ยิงถามขนส่งจริง (เสียโควตา) · ยิ่งส่วนเข้มสั้น แปลว่า cache ช่วยประหยัดได้มาก"
          >
            {efficiency.length === 0 ? (
              <Empty>ยังไม่มีการค้นหาในช่วงนี้</Empty>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Tile
                    label="ค้นหาทั้งหมด"
                    value={count(efficiencyTotals.total)}
                  />
                  <Tile
                    label="ยิง API จริง"
                    value={count(efficiencyTotals.fromApi)}
                    hint={percent(efficiencyTotals.fromApi, efficiencyTotals.total)}
                  />
                  <Tile
                    label="ประหยัดด้วย cache"
                    value={count(efficiencyTotals.fromCache)}
                    hint={percent(efficiencyTotals.fromCache, efficiencyTotals.total)}
                  />
                </div>

                <ul className="mt-4 flex flex-col gap-1">
                  {efficiency.map((day) => (
                    <li key={day.day} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 font-mono text-[11px] text-faint">
                        {day.day.slice(5)}
                      </span>
                      {/* แท่งซ้อนสองชั้น: ชั้นอ่อนคือค้นหาทั้งหมด ชั้นเข้มคือ
                          ส่วนที่ยิงจริง — อ่านสองเส้นในแท่งเดียวได้โดยไม่ต้อง
                          ไล่สายตาข้ามกราฟสองอัน */}
                      <span className="relative h-4 flex-1 overflow-hidden rounded bg-line">
                        <span
                          className="absolute inset-y-0 left-0 rounded bg-ink/25"
                          style={{
                            width: `${efficiencyPeak === 0 ? 0 : (day.total / efficiencyPeak) * 100}%`,
                          }}
                        />
                        <span
                          className="absolute inset-y-0 left-0 rounded bg-ink"
                          style={{
                            width: `${efficiencyPeak === 0 ? 0 : (day.fromApi / efficiencyPeak) * 100}%`,
                          }}
                        />
                      </span>
                      <span className="w-28 shrink-0 text-right font-mono text-[11px] text-faint">
                        {count(day.fromApi)}/{count(day.total)} ·{" "}
                        {percent(day.fromApi, day.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>

          <Section title="ค้นหาแยกตามวัน" note="เวลาไทย · วันที่ไม่มีการค้นจะไม่ปรากฏ">
            {daily.length === 0 ? (
              <Empty>ยังไม่มีการค้นหาในช่วงนี้</Empty>
            ) : (
              <ul className="flex flex-col gap-1">
                {daily.map((day) => (
                  <li key={day.day} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 font-mono text-[11px] text-faint">
                      {day.day.slice(5)}
                    </span>
                    <span className="h-4 flex-1 overflow-hidden rounded bg-line">
                      <span
                        className="block h-full rounded bg-ink"
                        style={{
                          width: `${busiestDay === 0 ? 0 : (day.total / busiestDay) * 100}%`,
                        }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono text-[11px] text-faint">
                      {count(day.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="ขนส่งยอดนิยม" note="นับเฉพาะครั้งที่ค้นเจอจึงรู้ว่าเป็นเจ้าไหน">
            {carriers.length === 0 ? (
              <Empty>ยังไม่มีข้อมูล</Empty>
            ) : (
              <ul className="flex flex-col gap-1">
                {carriers.map((carrier) => (
                  <li key={carrier.carrierCode} className="flex items-center gap-3">
                    <span className="w-36 shrink-0 truncate font-mono text-[11px] text-faint">
                      {carrier.carrierCode}
                    </span>
                    <span className="h-4 flex-1 overflow-hidden rounded bg-line">
                      <span
                        className="block h-full rounded bg-ink"
                        style={{
                          width: `${carrierPeak === 0 ? 0 : (carrier.total / carrierPeak) * 100}%`,
                        }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono text-[11px] text-faint">
                      {count(carrier.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="โควตาที่ใช้ของแต่ละเจ้า"
            note={`นับเป็น "จำนวน request ที่ยิงออกจากเราจริง" ทุกรอบที่ลองใหม่ก็นับ — ไม่ใช่ยอดบิล ซึ่งบางเจ้าคิดเป็นรายเลขพัสดุ ตัวเลขสองอันนี้ไม่มีวันตรงกัน · แถบสีขึ้นเมื่อใช้เกิน ${Math.round(leanRatio * 100)}%`}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PROVIDER_IDS.map((provider) => {
                const used = usageByProvider.get(provider)?.callCount ?? 0;
                const quota = readQuota(provider);
                const reserve = readHarvestReserve(provider);
                const reset = nextResetOf(provider);

                return (
                  <QuotaTile
                    key={provider}
                    label={PROVIDER_LABEL[provider]}
                    used={used}
                    quota={quota}
                    reserve={reserve}
                    resetAt={reset}
                    warnAt={leanRatio}
                  />
                );
              })}
            </div>

            {/* cache ของภาพแผนที่ — วางคู่กับการ์ดโควตาโดยตั้งใจ
                เพราะมันคือตัวเลขที่อธิบายว่าทำไมโควตา Google แผนที่ถึงต่ำ
                (หรือทำไมถึงสูงกว่าที่ควร)

                ⚠️ ตัวเลขนี้คือข้อมูลที่จะใช้ปรับเพดาน 500/วันหลังเปิด map จริง
                หนึ่งสัปดาห์ · สมมติฐานทั้งหมดที่ใช้ตั้งเพดาน ("สาขาซ้ำกันเยอะ",
                "ผู้ใช้ปกติจะไม่ชนเพดาน") ยังไม่มีข้อมูลรองรับเลย ถ้าไม่มีตัวนี้
                เราจะกลับไปเดาอีกรอบ

                รีเซ็ตตอน restart เหมือนตัว cache เอง — เป็นยอดสะสมตั้งแต่ deploy
                ล่าสุด ไม่ใช่ยอดตลอดกาล */}
            {mapCache.hits + mapCache.misses > 0 && (
              <div className="mt-4 rounded-xl border border-line bg-white/60 p-4">
                <p className="text-xs text-faint">
                  cache ภาพแผนที่ (ตั้งแต่ deploy ล่าสุด)
                </p>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Tile
                    label="ประหยัดได้"
                    value={percent(
                      mapCache.hits,
                      mapCache.hits + mapCache.misses,
                    )}
                    hint={`${count(mapCache.hits)} ครั้งที่ไม่ต้องจ่าย Google`}
                  />
                  <Tile
                    label="ยิง Google จริง"
                    value={count(mapCache.misses)}
                  />
                  <Tile label="ภาพที่เก็บอยู่" value={count(mapCache.stored)} />
                  <Tile
                    label="เพดานที่เก็บได้"
                    value={count(MAX_IMAGES)}
                    hint="ทิ้งภาพที่ไม่ได้ใช้นานที่สุดเมื่อเต็ม"
                  />
                </div>
              </div>
            )}

            {/* ⚠️ เจ้าที่โควตาไม่มีวันรีเซ็ตและใกล้ชนเพดานแล้ว
                ต้องเด่นตรงนี้ เพราะมันไม่มีทางไปโผล่ใน monitor ได้เลย —
                /api/health/quota ตอบ 503 เฉพาะเจ้าที่รอบบิลรีเซ็ตได้ ส่วนเจ้า
                แบบนี้ถ้าเอาไปใส่ด้วยจะ 503 ค้างตลอดกาลแล้วจบที่การปิดปากมันทิ้ง
                (ดูเหตุผลเต็มที่ app/api/health/quota/route.ts)

                หน้านี้จึงเป็น "ที่เดียว" ที่บอกเรื่องนี้ได้ ถ้าไม่เด่นพอ =
                ไม่มีใครรู้ */}
            {standingQuota.length > 0 && (
              <div className="mt-4 rounded-xl border border-seal/40 bg-seal/5 p-4">
                <p className="font-display text-sm font-semibold text-seal">
                  โควตาที่ใช้หมดแล้วหมดเลย — ต้องตัดสินใจ ไม่ใช่รอให้หายเอง
                </p>
                <ul className="mt-2 flex flex-col gap-2">
                  {standingQuota.map((provider) => {
                    const used = usageByProvider.get(provider)?.callCount ?? 0;
                    const quota = readQuota(provider);
                    const reserve = readHarvestReserve(provider);
                    const lookupLeft = Math.max(quota - reserve - used, 0);

                    return (
                      <li key={provider} className="text-xs leading-relaxed text-faint">
                        <span className="font-medium text-ink">
                          {PROVIDER_LABEL[provider]}
                        </span>{" "}
                        ใช้ไป {count(used)}/{count(quota)} ·{" "}
                        {lookupLeft === 0 ? (
                          <span className="text-seal">
                            งบสำหรับการค้นหาหมดแล้ว — ระบบตัดเจ้านี้ออกจากลำดับ
                            การค้นหาไปแล้ว เหลือแต่โควตาที่กันไว้ให้เก็บที่อยู่สาขา{" "}
                            {count(Math.max(quota - used, 0))} ครั้ง
                          </span>
                        ) : (
                          <>
                            เหลืองบค้นหาอีก {count(lookupLeft)} ครั้ง
                            (จากที่กัน {count(reserve)} ครั้งสุดท้ายไว้ให้เก็บที่อยู่สาขา)
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[11px] leading-relaxed text-faint">
                  ⚠️ ตัวเลขนี้นับจากฝั่งเรา ไม่ใช่ยอดจากหน้าแดชบอร์ดของผู้ให้บริการ
                  ถ้าสองอันไม่ตรงกัน ให้เชื่อของผู้ให้บริการ
                </p>
                {/* ⚠️ ข้อความนี้มีไว้ให้ตัวเราในอีกสองเดือนอ่าน — ตอนนั้นจะจำไม่ได้
                    แล้วว่าทำไม ETrackings ถึงไม่เคยถูกเรียกใช้ แล้วจะไปนั่งไล่โค้ด
                    หาบั๊กที่ไม่มีอยู่จริง · สภาพนี้เป็นสิ่งที่ตั้งใจให้เป็น */}
                <p className="mt-3 rounded-lg border border-line bg-white/70 p-3 text-[11px] leading-relaxed text-faint">
                  <span className="font-medium text-ink">
                    ทำไมถึงไม่ถูกเรียกใช้ในการค้นหาแล้ว
                  </span>
                  <br />
                  โควตาส่วนที่ให้การค้นหาใช้ถูกใช้ครบแล้ว ระบบจึงตัดเจ้านี้ออกจาก
                  ลำดับการค้นหาโดยอัตโนมัติ (canUseForLookup ใน
                  lib/provider-usage.ts) — <span className="text-ink">ไม่ใช่บั๊ก</span>{" "}
                  แต่เป็นสภาพที่ตั้งใจแช่ไว้ เพราะทรัพยากรที่ไม่มีวันเติมไม่ควรถูก
                  ปลดล็อกโดยไม่มีแผนเฉพาะว่าจะใช้ทำอะไร
                  <br />
                  ที่เหลืออยู่ถูกกันไว้ให้การเก็บที่อยู่สาขาเท่านั้น ซึ่งตอนนี้ก็ปิด
                  สวิตช์ไว้ด้วย — เท่ากับโควตาที่เหลือถูกแช่แข็งทั้งก้อน
                  จนกว่าจะมีคนตัดสินใจว่าจะเอาไปใช้ทำอะไร
                </p>
              </div>
            )}
          </Section>

          <Section
            title="ติดตั้งเป็นแอพ"
            note="นับจากตอนที่เบราว์เซอร์ยืนยันว่าติดตั้งสำเร็จ · ไม่ต้องล็อกอินจึงยิงปลอมได้ ถือเป็น “อย่างมากเท่านี้”"
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="ติดตั้งทั้งหมด" value={count(installs.total)} />
              <Tile label="30 วันล่าสุด" value={count(installs.last30d)} />
              <Tile label="Android" value={count(installs.android)} />
              <Tile
                label="iOS · เดสก์ท็อป"
                value={`${count(installs.ios)} · ${count(installs.desktop)}`}
              />
            </div>
          </Section>

          <Section
            title="ช่องทางที่มา"
            note="นับครั้งเดียวต่อเซสชัน · ไม่ผูกกับบัญชีผู้ใช้และไม่เก็บ URL ต้นทาง เก็บแค่ชื่อช่องทางคำเดียว"
          >
            {referrerRows.length === 0 ? (
              <Empty>ยังไม่มีข้อมูลช่องทางที่มาในช่วงนี้</Empty>
            ) : (
              <>
                <ul className="flex flex-col gap-1">
                  {referrerRows.map((row) => (
                    <li
                      key={row.channel}
                      className="flex items-center gap-3 border-b border-line py-1.5 last:border-0"
                    >
                      <span className="text-[13px] text-ink">
                        {REFERRER_LABEL[row.channel] ?? row.channel}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-faint">
                        7 วัน {count(row.last7d)}
                      </span>
                      <span className="w-24 shrink-0 text-right font-mono text-[11px] text-ink">
                        30 วัน {count(row.last30d)}
                      </span>
                      <span className="w-14 shrink-0 text-right font-mono text-[11px] text-faint">
                        {percent(row.last30d, referrerTotal30d)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs leading-relaxed text-faint">
                  “มาตรงๆ” รวมคนที่พิมพ์ที่อยู่เว็บเอง คนที่เปิดจากแอปที่ไม่ส่ง
                  referrer มาให้ และคนที่เปิดจากแอปที่ติดตั้งไว้ — สามอย่างนี้
                  แยกจากกันไม่ได้ด้วยข้อมูลที่เราเก็บ
                </p>
              </>
            )}
          </Section>

          <Section
            title="รูปแบบเลขที่ค้นไม่เจอบ่อย"
            note="ไม่ใช่เลขพัสดุ — ตัวเลขทุกตัวถูกแทนด้วย # เหลือแค่ตัวอักษรนำหน้าซึ่งพัสดุทุกใบของขนส่งเจ้านั้นใช้ร่วมกัน ย้อนกลับเป็นเลขจริงไม่ได้"
          >
            {unfoundShapes.length === 0 ? (
              <Empty>ยังไม่มีเลขที่ค้นไม่เจอในช่วงนี้</Empty>
            ) : (
              <>
                <ul className="flex flex-col gap-1">
                  {unfoundShapes.map((row) => (
                    <li
                      key={row.shape}
                      className="flex items-center gap-3 border-b border-line py-1.5 last:border-0"
                    >
                      <span className="font-mono text-[11px] text-ink">
                        {row.shape}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-faint">
                        {count(row.total)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs leading-relaxed text-faint">
                  ทรงที่โผล่บ่อยผิดปกติ = สัญญาณว่าอาจขาดแถวใน COURIER_PREFIXES
                  ไม่ใช่ข้อพิสูจน์ว่ามีบั๊ก — คนที่พิมพ์เลขผิดถูกนับรวมอยู่ด้วย
                  และเราแยกไม่ออก
                </p>
              </>
            )}
          </Section>

          <Section
            title="การ์ดชวนติดตั้ง"
            note="ปุ่มลอยที่ขึ้นหลังได้คำตอบจากขนส่งบนมือถือ · “แสดง” นับครั้งเดียวต่อเซสชัน จึงเทียบกันได้ระดับบอกทิศทาง ไม่ใช่ตัวเลขบัญชี"
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="แสดง" value={count(invite.shown)} />
              <Tile
                label="กดติดตั้ง"
                value={percent(invite.clicked, invite.shown)}
                hint={`${count(invite.clicked)} ครั้ง`}
              />
              <Tile
                label="กดปิด"
                value={percent(invite.dismissed, invite.shown)}
                hint={`${count(invite.dismissed)} ครั้ง`}
              />
              <Tile
                label="ไม่ตอบสนอง"
                value={percent(
                  Math.max(invite.shown - invite.clicked - invite.dismissed, 0),
                  invite.shown,
                )}
                hint="เห็นแล้วเลื่อนผ่าน"
              />
            </div>

            {/* แยกตามจังหวะที่การ์ดขึ้น — จังหวะ "ค้นไม่เจอ" เพิ่งเพิ่มเข้ามา
                ถ้าไม่แยก เวลาอัตราการกดขยับจะแยกไม่ออกว่าเป็นเพราะจังหวะใหม่
                หรือเพราะคนเห็นเยอะขึ้นเฉยๆ */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Tile
                label="ตอนค้นเจอ"
                value={percent(
                  invite.byContext.found.clicked,
                  invite.byContext.found.shown,
                )}
                hint={`แสดง ${count(invite.byContext.found.shown)} · กด ${count(invite.byContext.found.clicked)}`}
              />
              <Tile
                label="ตอนค้นไม่เจอ"
                value={percent(
                  invite.byContext.notFound.clicked,
                  invite.byContext.notFound.shown,
                )}
                hint={`แสดง ${count(invite.byContext.notFound.shown)} · กด ${count(invite.byContext.notFound.clicked)}`}
              />
            </div>
          </Section>

          <Section
            title="พิกัดสาขา"
            note="สาขาที่ยังไม่มีพิกัดจะไม่แสดงแผนที่ให้ผู้ใช้ (แสดงเป็นชื่อสถานที่แทน)"
          >
            {/* ⚠️ ตัวเลขคู่นี้ต้องอยู่ด้วยกันเสมอ — "ยิงไปกี่ครั้ง" คือต้นทุนที่จ่าย
                จริง (โควตา ETrackings ที่ไม่มีวันเติม) ส่วน "ได้พิกัดกี่สาขา" คือ
                ผลลัพธ์ · ถ้าโชว์แค่อย่างหลัง ค่า 0 จะอ่านได้ว่า "ยังไม่มีสาขาไหน
                ต้องใช้" ซึ่งฟังดูปกติ ทั้งที่ความจริงคือจ่ายไปแล้วไม่ได้อะไรกลับมา */}
            {branches.probeAttempts > 0 && (
              <p
                className={`mb-4 rounded-xl border p-4 text-xs leading-relaxed ${
                  branches.known === 0
                    ? "border-seal/40 bg-seal/5 text-faint"
                    : "border-line bg-white/60 text-faint"
                }`}
              >
                ยิงถามที่อยู่สาขาไปแล้ว{" "}
                <span className="font-mono text-ink">
                  {count(branches.probeAttempts)} ครั้ง
                </span>{" "}
                ได้พิกัดมาใช้จริง{" "}
                <span
                  className={`font-mono ${branches.known === 0 ? "text-seal" : "text-ink"}`}
                >
                  {count(branches.known)} สาขา
                </span>
                {branches.known === 0 && (
                  <>
                    {" "}
                    — จ่ายโควตา ETrackings ไปแล้วโดยยังไม่ได้อะไรกลับมา
                    <br />
                    {/* ⚠️ ถ้อยคำต้องตรงกับหลักฐาน ไม่ใช่กว้างๆ ว่า "ขั้น geocode
                        มีปัญหา" · ของจริง: geocode_cache 7 แถว found=true ทุกแถว
                        แปลว่า Google หาพิกัดเจอทุกครั้ง แต่ถูกด่านความแม่นยำ
                        ปฏิเสธเพราะเป็นพิกัดระดับพื้นที่ ไม่ใช่ของอาคาร

                        ข้อสังเกตที่ยังไม่ได้แก้ (harvest ปิดอยู่แล้ว):
                        log แสดง radius=82m ก็ยังถูกปฏิเสธ ทั้งที่เกณฑ์ระยะคือ
                        ≤150m = แม่น → แปลว่าโดนด่าน types[] ไม่ใช่ด่านระยะ
                        ซึ่งบ่งชี้ว่าที่อยู่ที่ส่งไปเป็นชื่อตำบล/พื้นที่ ไม่ใช่
                        ที่อยู่สาขาจริง — วนกลับไปหาบั๊ก cleanBranchAddress
                        ที่รวมที่อยู่ต้นทางกับปลายทางเป็นก้อนเดียว */}
                    Google หาพิกัดเจอทุกครั้ง แต่ได้มาเป็นพิกัด
                    <span className="text-ink">ระดับพื้นที่ ไม่ใช่ของอาคาร</span>{" "}
                    จึงถูกปฏิเสธตามเกณฑ์ความแม่นยำ — ปัญหาอยู่ที่
                    <span className="text-ink">ที่อยู่ที่ส่งไปให้ Google</span>{" "}
                    ไม่ใช่ที่การยิง ETrackings และไม่ใช่ที่ Google
                  </>
                )}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="มีพิกัดแล้ว" value={count(branches.known)} />
              <Tile label="ยังไม่มีพิกัด" value={count(branches.unknown)} />
              <Tile
                label="เป็นรหัสสาขา"
                value={count(branches.unknownByKind.branch ?? 0)}
              />
              <Tile
                label="เป็นข้อความอื่น"
                value={count(
                  (branches.unknownByKind.address ?? 0) +
                    (branches.unknownByKind.unknown ?? 0),
                )}
              />
            </div>

            <Link
              href="/admin/branches"
              className="mt-4 inline-block text-sm font-medium text-ink underline underline-offset-4"
            >
              ไปที่หน้ากรอกพิกัดสาขา
            </Link>
          </Section>
        </div>
      </main>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-line-strong p-5 text-center text-sm text-faint">
      {children}
    </p>
  );
}

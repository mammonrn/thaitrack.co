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

import { PROVIDER_IDS, PROVIDER_LABEL, currentMonth, readQuota } from "@/lib/provider-usage";
import { requireAdmin } from "@/lib/supabase/admin-guard";
import { countBranches } from "@/lib/supabase/locations";
import { listProviderUsage } from "@/lib/supabase/provider-usage";
import {
  readErrorBreakdown,
  readInstallStats,
  readLatency,
  readMemberActivity,
  readMemberStats,
  readSearchDaily,
  readSearchOverview,
  readTopCarriers,
} from "@/lib/supabase/search-events";

/** ต้องรันบน Node.js runtime และห้าม cache — ตัวเลขเปลี่ยนตลอดเวลา */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ช่วงที่หน้านี้มองย้อนหลัง */
const WINDOW_DAYS = 30;
const TOP_CARRIER_LIMIT = 8;

/** จำนวนแบบอ่านง่าย เช่น 12,345 */
const count = (value: number) => value.toLocaleString("th-TH");

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

export default async function AdminStatsPage() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    console.warn(`[admin] ปฏิเสธการเปิดหน้าสถิติ: ${admin.reason}`);
    notFound();
  }

  const month = currentMonth();

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
    installs,
  ] = await Promise.all([
    readMemberStats(),
    readMemberActivity(),
    readSearchOverview(0),
    readSearchOverview(WINDOW_DAYS),
    readSearchDaily(WINDOW_DAYS),
    readTopCarriers(WINDOW_DAYS, TOP_CARRIER_LIMIT),
    countBranches(),
    listProviderUsage(month),
    readErrorBreakdown(WINDOW_DAYS),
    readLatency(WINDOW_DAYS),
    readInstallStats(),
  ]);

  const answered = recent.found + recent.notFound;
  const cacheable = recent.fromCache + recent.fromApi;
  const busiestDay = daily.reduce((most, day) => Math.max(most, day.total), 0);
  const carrierPeak = carriers.reduce((most, row) => Math.max(most, row.total), 0);

  const usageByProvider = new Map(usage.map((row) => [row.provider, row]));

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
          เข้าสู่ระบบเป็น {admin.email} · ช่วงที่แสดง {WINDOW_DAYS} วันล่าสุด
        </p>

        <div className="mt-8 flex flex-col gap-10">
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
                hint={`${WINDOW_DAYS} วัน · รวมคนที่ไม่ได้ล็อกอินด้วย`}
              />
            </div>
          </Section>

          <Section
            title="การค้นหา"
            note={`ยอดสะสมทั้งหมด ${count(allTime.total)} ครั้ง`}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label={`ค้นหา ${WINDOW_DAYS} วัน`} value={count(recent.total)} />
              <Tile
                label="ค้นเจอ"
                value={percent(recent.found, answered)}
                hint={`${count(recent.found)} ครั้ง`}
              />
              <Tile
                label="ค้นไม่เจอ"
                value={percent(recent.notFound, answered)}
                hint={`${count(recent.notFound)} ครั้ง`}
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
            note={`เดือน ${month} · นับเป็นจำนวน request ที่ยิงออกไปจริง ซึ่งสูงกว่ายอดบิลของเจ้าที่คิดเป็นรายเลขพัสดุ`}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PROVIDER_IDS.map((provider) => {
                const used = usageByProvider.get(provider)?.callCount ?? 0;
                const quota = readQuota(provider);
                return (
                  <Tile
                    key={provider}
                    label={PROVIDER_LABEL[provider]}
                    value={`${count(used)} / ${count(quota)}`}
                    hint={`ใช้ไป ${percent(used, quota)} ของเพดานที่ตั้งไว้`}
                  />
                );
              })}
            </div>
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
            title="พิกัดสาขา"
            note="สาขาที่ยังไม่มีพิกัดจะไม่แสดงแผนที่ให้ผู้ใช้ (แสดงเป็นชื่อสถานที่แทน)"
          >
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

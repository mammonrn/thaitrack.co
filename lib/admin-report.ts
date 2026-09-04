/**
 * ประกอบรายงานสถิติเป็นไฟล์ — ตรรกะบริสุทธิ์ ไม่แตะเครือข่ายและไม่แตะ DOM
 *
 * ⚠️ ข้อบังคับเดียวกับหน้า /admin/stats ทุกประการ: **ตัวเลขรวมเท่านั้น**
 * ทุกฟิลด์ในรายงานมาจากฟังก์ชันที่คืน count(*) อยู่แล้ว ไฟล์นี้แค่จัดรูป
 * ไม่ได้ไปดึงอะไรเพิ่ม จึงไม่มีทางที่รายงานจะมีข้อมูลที่หน้าเว็บไม่มี
 *
 * ห้ามเพิ่มฟิลด์ที่ระบุตัวบุคคลได้ลงในรายงานเด็ดขาด — ไฟล์ที่ export ออกไปแล้ว
 * เดินทางต่อไปที่ไหนก็ได้ (แชท อีเมล ไดรฟ์) ต่างจากหน้าเว็บที่ต้องล็อกอินดู
 *
 * แยกออกมาจาก component เพื่อให้เทสต์ครอบรูปแบบไฟล์ได้โดยไม่ต้อง render อะไร
 */

import type { ProviderId } from "./provider-usage";

/** โควตาของผู้ให้บริการหนึ่งเจ้า ณ เวลาที่ออกรายงาน */
export interface ReportQuota {
  provider: ProviderId;
  label: string;
  used: number;
  quota: number;
  reserve: number;
  period: string;
}

/** หนึ่งวันในตารางความคุ้มค่า */
export interface ReportEfficiencyDay {
  day: string;
  total: number;
  fromApi: number;
  fromCache: number;
  failed: number;
}

/**
 * ก้อนข้อมูลทั้งหน้า — หน้าสถิติเป็นคนประกอบแล้วส่งให้ปุ่ม export
 *
 * ส่งเป็น props ลงไปฝั่ง client แทนที่จะให้ปุ่มไปเรียก API ใหม่ตอนกด เพื่อให้
 * ไฟล์ที่ได้ **ตรงกับตัวเลขที่ตาเห็นบนหน้าจอเป๊ะๆ** ไม่ใช่ตัวเลขของอีกวินาที
 * หนึ่งที่อาจต่างออกไป และไม่ต้องยิง query ชุดเดิมซ้ำอีกรอบ
 */
export interface ReportData {
  /** เวลาที่กดออกรายงาน (ISO 8601) */
  generatedAt: string;
  windowDays: number;
  members: { total: number; new7d: number; new30d: number };
  activity: { active7d: number; activePrev7d: number; returned: number; saves7d: number };
  searchAllTime: { total: number; found: number; notFound: number; error: number };
  searchWindow: {
    total: number;
    found: number;
    notFound: number;
    error: number;
    fromCache: number;
    fromApi: number;
    stale: number;
  };
  efficiency: ReportEfficiencyDay[];
  carriers: { carrierCode: string; total: number }[];
  errors: { reason: string; upstreamCode: string | null; total: number }[];
  latency: { source: string; label: string; p50Ms: number; p95Ms: number; total: number }[];
  unfoundShapes: { shape: string; total: number }[];
  unknownCourierFailures: number;
  quotas: ReportQuota[];
  branches: { known: number; unknown: number };
  installs: { total: number; last7d: number; last30d: number };
  invite: { shown: number; clicked: number; dismissed: number };
  referrers: { channel: string; last7d: number; last30d: number }[];
  settings: Record<string, boolean>;
}

/** ชื่อไฟล์ที่ดาวน์โหลด — ใส่วันเวลาไทยไว้กันไฟล์ทับกัน */
export function reportFileName(generatedAt: string, extension: "json" | "md"): string {
  const stamp = new Date(generatedAt)
    .toLocaleString("sv-SE", { timeZone: "Asia/Bangkok" })
    .replace(/[^\d]/g, "")
    .slice(0, 12);
  return `thaitrack-stats-${stamp}.${extension}`;
}

/** ตัวเลขแบบอ่านง่าย เช่น 12,345 */
function n(value: number): string {
  return value.toLocaleString("en-US");
}

/** สัดส่วนเป็นเปอร์เซ็นต์ — "—" เมื่อฐานเป็นศูนย์ ไม่ใช่ 0% ซึ่งชวนเข้าใจผิด */
function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

/** ตารางมาร์กดาวน์จากหัวคอลัมน์กับแถว */
function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "_(ไม่มีข้อมูลในช่วงนี้)_";

  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [head, rule, body].join("\n");
}

/**
 * รายงานเป็น Markdown — สำหรับอ่านด้วยตาและวางลงแชท
 *
 * เรียงหัวข้อตามลำดับเดียวกับบนหน้าเว็บ เพื่อให้คนที่อ่านไฟล์กับคนที่ดูหน้าจอ
 * คุยกันรู้เรื่องโดยไม่ต้องไล่หาว่าหัวข้อไหนอยู่ตรงไหน
 */
export function toMarkdown(data: ReportData): string {
  const at = new Date(data.generatedAt).toLocaleString("th-TH", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });

  const lines: string[] = [
    "# รายงานสถิติ พัสดุไทย.com",
    "",
    `ออกรายงานเมื่อ ${at} น. · ช่วงที่แสดง ${data.windowDays} วันล่าสุด`,
    "",
    "> ตัวเลขรวมทั้งระบบเท่านั้น ไม่มีข้อมูลรายบุคคล ไม่มี IP และไม่มีเลขพัสดุ",
    "> อยู่ในรายงานนี้เลย",
    "",
    "## สมาชิก",
    "",
    table(
      ["รายการ", "จำนวน"],
      [
        ["สมาชิกทั้งหมด", n(data.members.total)],
        ["สมัครใหม่ 7 วัน", n(data.members.new7d)],
        ["สมัครใหม่ 30 วัน", n(data.members.new30d)],
      ],
    ),
    "",
    "## การกลับมาใช้ซ้ำ",
    "",
    "_วัดจากการบันทึกพัสดุ ไม่ใช่การค้นหา — ตัวเลขจึงต่ำกว่าความจริงเสมอ_",
    "",
    table(
      ["รายการ", "จำนวน"],
      [
        ["สมาชิกที่บันทึกพัสดุ 7 วัน", n(data.activity.active7d)],
        ["สัปดาห์ก่อนหน้า", n(data.activity.activePrev7d)],
        ["กลับมาสัปดาห์ถัดไป", n(data.activity.returned)],
        ["จำนวนการบันทึก 7 วัน", n(data.activity.saves7d)],
      ],
    ),
    "",
    "## การค้นหา",
    "",
    table(
      ["ช่วง", "ทั้งหมด", "เจอ", "ไม่เจอ", "ล้มเหลว"],
      [
        [
          "ตลอดกาล",
          n(data.searchAllTime.total),
          n(data.searchAllTime.found),
          n(data.searchAllTime.notFound),
          n(data.searchAllTime.error),
        ],
        [
          `${data.windowDays} วัน`,
          n(data.searchWindow.total),
          n(data.searchWindow.found),
          n(data.searchWindow.notFound),
          n(data.searchWindow.error),
        ],
      ],
    ),
    "",
    `ตอบจาก cache **${n(data.searchWindow.fromCache)}** · ยิง API จริง **${n(data.searchWindow.fromApi)}** · ข้อมูลเก่าที่ใช้แทนตอนขนส่งล่ม ${n(data.searchWindow.stale)}`,
    "",
    "## ค้นหา เทียบ โควตาที่ใช้จริง (รายวัน)",
    "",
    "_ยิ่งสัดส่วน \"ยิง API\" ต่ำ แปลว่า cache ช่วยประหยัดได้มาก_",
    "",
    table(
      ["วัน", "ค้นหา", "ยิง API จริง", "จาก cache", "ล้มเหลว", "สัดส่วนที่ยิงจริง"],
      data.efficiency.map((row) => [
        row.day,
        n(row.total),
        n(row.fromApi),
        n(row.fromCache),
        n(row.failed),
        pct(row.fromApi, row.total),
      ]),
    ),
    "",
    "## ขนส่งที่ค้นเจอบ่อย",
    "",
    table(
      ["ขนส่ง", "จำนวน"],
      data.carriers.map((row) => [row.carrierCode, n(row.total)]),
    ),
    "",
    "## ความล้มเหลว",
    "",
    table(
      ["สาเหตุ", "code ปลายทาง", "จำนวน"],
      data.errors.map((row) => [row.reason, row.upstreamCode ?? "—", n(row.total)]),
    ),
    "",
    `ล้มตอนเหลือผู้ให้บริการเจ้าเดียว (เดา courier ไม่ออก): **${n(data.unknownCourierFailures)}** ครั้ง`,
    "",
    "### รูปแบบเลขที่ค้นไม่เจอ",
    "",
    table(
      ["รูปแบบ", "จำนวน"],
      data.unfoundShapes.map((row) => [`\`${row.shape}\``, n(row.total)]),
    ),
    "",
    "## เวลาตอบสนอง",
    "",
    table(
      ["ชั้นที่ตอบ", "p50", "p95", "จำนวน"],
      data.latency.map((row) => [
        row.label,
        `${n(row.p50Ms)} ms`,
        `${n(row.p95Ms)} ms`,
        n(row.total),
      ]),
    ),
    "",
    "## โควตาผู้ให้บริการ",
    "",
    table(
      ["ผู้ให้บริการ", "ใช้ไป", "เพดาน", "สงวนไว้", "รอบ"],
      data.quotas.map((row) => [
        row.label,
        n(row.used),
        n(row.quota),
        row.reserve > 0 ? n(row.reserve) : "—",
        row.period,
      ]),
    ),
    "",
    "## พิกัดสาขา",
    "",
    `มีพิกัดแล้ว **${n(data.branches.known)}** · ยังไม่รู้พิกัด **${n(data.branches.unknown)}**`,
    "",
    "## การติดตั้งแอป",
    "",
    table(
      ["รายการ", "จำนวน"],
      [
        ["ติดตั้งทั้งหมด (ตลอดกาล)", n(data.installs.total)],
        ["ติดตั้ง 7 วัน", n(data.installs.last7d)],
        ["ติดตั้ง 30 วัน", n(data.installs.last30d)],
        ["การ์ดชวนติดตั้ง — แสดง", n(data.invite.shown)],
        ["การ์ดชวนติดตั้ง — กดติดตั้ง", n(data.invite.clicked)],
        ["การ์ดชวนติดตั้ง — กดปิด", n(data.invite.dismissed)],
      ],
    ),
    "",
    "## ช่องทางที่มา",
    "",
    table(
      ["ช่องทาง", "7 วัน", "30 วัน"],
      data.referrers.map((row) => [row.channel, n(row.last7d), n(row.last30d)]),
    ),
    "",
    "## สวิตช์ระบบ",
    "",
    table(
      ["สวิตช์", "สถานะ"],
      Object.entries(data.settings).map(([key, value]) => [
        `\`${key}\``,
        value ? "เปิด" : "ปิด",
      ]),
    ),
    "",
  ];

  return lines.join("\n");
}

/** รายงานเป็น JSON — จัดฟอร์แมตให้อ่านด้วยตาได้ด้วย ไม่ใช่บรรทัดเดียวยาวๆ */
export function toJson(data: ReportData): string {
  return JSON.stringify(data, null, 2);
}

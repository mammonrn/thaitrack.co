/**
 * แปลข้อความสถานะพัสดุเป็นภาษาไทย
 *
 * ขนส่งข้ามประเทศ (เห็นชัดกับ SPX/Shopee ที่ส่งผ่าน Track123) ส่งข้อความมาเป็น
 * ภาษาอังกฤษล้วนในรูปแบบ
 *
 *   "[Transit Warehouse Inbound] [China]Parcel has arrived at :Shenzhen sorting centre"
 *    └── tag ──────────────────┘ └ประเทศ┘└── ประโยค ────────────────────────┘
 *
 * โมดูลนี้แยกสามส่วนนั้นออกจากกันแล้วแปลทีละชั้น ถ้าแปลไม่ได้จะคืนข้อความเดิม
 * เสมอ ผู้ใช้จึงไม่มีทางเห็นช่องว่างหรือข้อความที่หายไป
 *
 * ชื่อเมืองและสถานที่เฉพาะ (Shenzhen, ShiYan) ไม่แปล คงไว้ตามต้นฉบับ แปลเฉพาะ
 * คำนามทั่วไปที่ต่อท้าย เช่น "sorting centre" แล้วสลับลำดับให้อ่านแบบไทย
 * ("Shenzhen sorting centre" → "ศูนย์คัดแยก Shenzhen")
 *
 * การเพิ่มคำแปลใหม่ทำได้ด้วยการเติม entry ในตารางด้านล่าง ไม่ต้องแก้ logic
 */

export interface ParsedStatus {
  /** ข้อความในวงเล็บเหลี่ยมอันแรก เช่น "Transit Warehouse Inbound" */
  tag: string | null;
  /** ประเทศในวงเล็บเหลี่ยมอันที่สอง เช่น "China" */
  country: string | null;
  /** ประโยคที่เหลือหลังตัดวงเล็บออก */
  body: string;
}

/** ตัดช่องว่างซ้ำและทำเป็นตัวพิมพ์เล็ก ใช้เป็นกุญแจค้นตาราง */
function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * แยก tag / ประเทศ / ประโยค ออกจากกัน
 *
 * วงเล็บเหลี่ยมอันแรกคือ tag เสมอ ส่วนอันที่สอง (ถ้ามีและติดกับประโยคเลย)
 * คือประเทศที่เหตุการณ์เกิดขึ้น
 */
export function parseStatusText(raw: string): ParsedStatus {
  let rest = raw.trim();
  let tag: string | null = null;
  let country: string | null = null;

  const tagMatch = /^\[([^\]]+)\]\s*/.exec(rest);
  if (tagMatch !== null) {
    tag = tagMatch[1].trim();
    rest = rest.slice(tagMatch[0].length);
  }

  const countryMatch = /^\[([^\]]+)\]\s*/.exec(rest);
  if (countryMatch !== null) {
    country = countryMatch[1].trim();
    rest = rest.slice(countryMatch[0].length);
  }

  return { tag, country, body: rest.trim() };
}

/* ------------------------------------------------------------------ *
 * ตารางคำแปล — เติม entry ใหม่ได้เลยโดยไม่ต้องแก้ logic
 * ------------------------------------------------------------------ */

const COUNTRY_TH: Record<string, string> = {
  china: "จีน",
  thailand: "ไทย",
  singapore: "สิงคโปร์",
  malaysia: "มาเลเซีย",
  "hong kong": "ฮ่องกง",
  japan: "ญี่ปุ่น",
  "south korea": "เกาหลีใต้",
  taiwan: "ไต้หวัน",
  vietnam: "เวียดนาม",
  indonesia: "อินโดนีเซีย",
};

/** คำแปลของ tag ในวงเล็บ ใช้เมื่อแปลทั้งประโยคไม่ได้ */
const TAG_TH: Record<string, string> = {
  manifested: "ผู้ส่งเตรียมพัสดุ",
  "order created": "สร้างคำสั่งซื้อแล้ว",
  "pickup from cross border seller": "ผู้ขายส่งพัสดุแล้ว",
  "picked up": "รับพัสดุแล้ว",
  collected: "รับพัสดุแล้ว",
  "forwarder received parcel": "ส่งมอบให้ผู้ให้บริการขนส่งแล้ว",
  "transit warehouse inbound": "ถึงคลังพักสินค้า",
  "transit warehouse outbound": "ออกจากคลังพักสินค้า",
  "arrived at sorting center": "ถึงศูนย์คัดแยก",
  "arrived at sorting centre": "ถึงศูนย์คัดแยก",
  "departed from sorting center": "ออกจากศูนย์คัดแยก",
  "departed from sorting centre": "ออกจากศูนย์คัดแยก",
  "export customs processing": "อยู่ระหว่างพิธีการศุลกากรขาออก",
  "export customs cleared": "ผ่านพิธีการศุลกากรขาออกแล้ว",
  "import customs processing": "อยู่ระหว่างพิธีการศุลกากรขาเข้า",
  "import customs cleared": "ผ่านพิธีการศุลกากรขาเข้าแล้ว",
  "handed over to airline": "ส่งมอบให้สายการบินแล้ว",
  "export flight departed": "ขึ้นเครื่องออกจากประเทศต้นทางแล้ว",
  "import flight arrived": "เครื่องถึงประเทศปลายทางแล้ว",
  "flight departed": "ขึ้นเครื่องแล้ว",
  "flight arrived": "เครื่องถึงปลายทางแล้ว",
  "arrived at destination airport": "ถึงสนามบินปลายทาง",
  "handed over to local carrier": "ส่งมอบให้ขนส่งในประเทศแล้ว",
  "arrived at delivery branch": "ถึงสาขาที่จะนำจ่าย",
  "departed from origin country": "ออกจากประเทศต้นทางแล้ว",
  "arrived at destination country": "ถึงประเทศปลายทางแล้ว",
  "in transit": "อยู่ระหว่างขนส่ง",
  "out for delivery": "กำลังนำจ่าย",
  delivering: "กำลังนำจ่าย",
  delivered: "ส่งถึงแล้ว",
  signed: "เซ็นรับพัสดุแล้ว",
  "delivery failed": "นำจ่ายไม่สำเร็จ",
  "failed attempt": "นำจ่ายไม่สำเร็จ",
  "return to sender": "ตีกลับผู้ส่ง",
  returned: "ตีกลับผู้ส่ง",
  exception: "พัสดุมีปัญหา",
};

/**
 * คำนามสถานที่ที่ต่อท้ายชื่อเฉพาะ
 *
 * แปลแล้วสลับมาไว้หน้าชื่อ เพราะภาษาไทยเรียงแบบ "ศูนย์คัดแยก Shenzhen"
 * ไม่ใช่ "Shenzhen ศูนย์คัดแยก"
 */
const PLACE_SUFFIX_RULES: { pattern: RegExp; noun: string }[] = [
  { pattern: /^(.+?)\s+sorting\s+cent(?:er|re)$/i, noun: "ศูนย์คัดแยก" },
  { pattern: /^(.+?)\s+(?:international\s+)?airport$/i, noun: "สนามบิน" },
  { pattern: /^(.+?)\s+warehouse$/i, noun: "คลังสินค้า" },
  { pattern: /^(.+?)\s+hub$/i, noun: "ศูนย์กระจายสินค้า" },
  { pattern: /^(.+?)\s+(?:distribution\s+)?cent(?:er|re)$/i, noun: "ศูนย์กระจายสินค้า" },
  { pattern: /^(.+?)\s+branch$/i, noun: "สาขา" },
];

/** แปลเฉพาะคำนามทั่วไปที่ต่อท้าย คงชื่อเฉพาะไว้เหมือนเดิม */
export function translatePlace(place: string): string {
  const trimmed = place.trim();

  for (const { pattern, noun } of PLACE_SUFFIX_RULES) {
    const match = pattern.exec(trimmed);
    if (match !== null) return `${noun} ${match[1].trim()}`;
  }

  return trimmed;
}

/**
 * กฎแปลประโยค
 *
 * เรียงจากเฉพาะเจาะจงไปกว้าง เพราะจะหยุดที่กฎแรกที่ตรง กฎที่มีวงเล็บจับกลุ่ม
 * จะเอาชื่อสถานที่ที่จับได้มาต่อท้ายคำแปล เพื่อไม่ให้ชื่อเฉพาะหายไป
 */
const BODY_RULES: { pattern: RegExp; to: (match: RegExpExecArray) => string }[] = [
  {
    pattern: /^parcel has departed from\s*:?\s*(.+)$/i,
    to: (m) => `ออกจาก${translatePlace(m[1])}`,
  },
  {
    pattern: /^parcel has arrived at\s*:?\s*(.+)$/i,
    to: (m) => `ถึง${translatePlace(m[1])}`,
  },
  {
    pattern: /^parcel has been handed over to\s+(.+)$/i,
    to: () => "ส่งมอบให้ผู้ให้บริการขนส่งแล้ว",
  },
  { pattern: /^parcel has been delivered$/i, to: () => "ส่งถึงแล้ว" },
  { pattern: /^parcel has cleared export customs$/i, to: () => "ผ่านพิธีการศุลกากรขาออกแล้ว" },
  { pattern: /^parcel has cleared import customs$/i, to: () => "ผ่านพิธีการศุลกากรขาเข้าแล้ว" },
  { pattern: /^parcel is out for delivery$/i, to: () => "กำลังนำจ่าย" },
  { pattern: /^parcel has been picked up$/i, to: () => "รับพัสดุแล้ว" },
  { pattern: /^sender has shipped your parcel$/i, to: () => "ผู้ขายส่งพัสดุแล้ว" },
  { pattern: /^sender is preparing to ship your parcel$/i, to: () => "ผู้ส่งกำลังเตรียมพัสดุ" },
  { pattern: /^your parcel has been signed for$/i, to: () => "เซ็นรับพัสดุแล้ว" },
  { pattern: /^delivery failed$/i, to: () => "นำจ่ายไม่สำเร็จ" },
  { pattern: /^parcel has departed on flight$/i, to: () => "พัสดุขึ้นเครื่องแล้ว" },
  { pattern: /^parcel has arrived in destination country$/i, to: () => "ถึงประเทศปลายทางแล้ว" },
];

/** true เมื่อข้อความมีอักษรไทยอยู่แล้ว ไม่ต้องแปลซ้ำ */
function hasThai(value: string): boolean {
  return /[฀-๿]/.test(value);
}

/**
 * แปลข้อความสถานะหนึ่งบรรทัด
 *
 * คืนข้อความเดิมเมื่อแปลไม่ได้ เพื่อให้ผู้ใช้ยังเห็นข้อมูลครบ ดีกว่าเห็นคำว่า
 * "ไม่ทราบสถานะ" ที่ไม่ได้บอกอะไรเลย
 */
export function translateStatusText(raw: string): string {
  const original = raw.trim();
  if (original === "") return original;

  // ไปรษณีย์ไทยส่งภาษาไทยมาอยู่แล้ว ไม่ต้องยุ่ง
  if (hasThai(original)) return original;

  const { tag, country, body } = parseStatusText(original);

  let translated: string | null = null;

  for (const { pattern, to } of BODY_RULES) {
    const match = pattern.exec(body);
    if (match !== null) {
      translated = to(match);
      break;
    }
  }

  // แปลทั้งประโยคไม่ได้ ลองใช้คำแปลของ tag แทน
  if (translated === null && tag !== null) {
    translated = TAG_TH[normalizeKey(tag)] ?? null;
  }

  // แปลไม่ได้เลยทั้งสองชั้น → คืนต้นฉบับ
  if (translated === null) return original;

  const countryTh =
    country === null ? null : (COUNTRY_TH[normalizeKey(country)] ?? country);

  return countryTh === null ? translated : `${translated} (${countryTh})`;
}

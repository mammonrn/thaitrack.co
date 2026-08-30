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
  "delivery driver assigned": "มอบหมายพนักงานนำจ่ายแล้ว",
  "enter last mile hub": "ถึงสาขาปลายทาง",
  "leave last mile hub": "ออกจากสาขาปลายทาง",
  "arrived at station": "ถึงสาขา",
  "departed station": "ออกจากสาขา",
  "departed from station": "ออกจากสาขา",
  delivered: "ส่งถึงแล้ว",
  signed: "เซ็นรับพัสดุแล้ว",
  "delivery failed": "นำจ่ายไม่สำเร็จ",
  "failed attempt": "นำจ่ายไม่สำเร็จ",
  "return to sender": "ตีกลับผู้ส่ง",
  returned: "ตีกลับผู้ส่ง",
  exception: "พัสดุมีปัญหา",
};

/**
 * คำนามทั่วไปที่ใช้เรียกสถานที่
 *
 * ขนส่งเขียนได้ทั้งแบบวางไว้หน้าชื่อ ("station :ACRAI-B") และต่อท้ายชื่อ
 * ("Shenzhen sorting centre") จึงต้องรู้จักทั้งสองรูปแบบ ไม่งั้นคำอย่าง
 * "station" จะค้างเป็นภาษาอังกฤษกลางประโยคไทย
 *
 * เรียงจากวลียาวไปสั้น เพราะจะหยุดที่กฎแรกที่ตรง ("origin port" ต้องมาก่อน "port")
 */
const PLACE_NOUNS: { pattern: string; noun: string }[] = [
  { pattern: "origin port", noun: "ท่าต้นทาง" },
  { pattern: "destination port", noun: "ท่าปลายทาง" },
  { pattern: "sorting cent(?:er|re)", noun: "ศูนย์คัดแยก" },
  { pattern: "distribution cent(?:er|re)", noun: "ศูนย์กระจายสินค้า" },
  { pattern: "last mile hub", noun: "สาขาปลายทาง" },
  { pattern: "(?:international\\s+)?airport", noun: "สนามบิน" },
  { pattern: "warehouse", noun: "คลังสินค้า" },
  { pattern: "station", noun: "สาขา" },
  { pattern: "branch", noun: "สาขา" },
  { pattern: "hub", noun: "ศูนย์กระจายสินค้า" },
  { pattern: "port", noun: "ท่า" },
  { pattern: "cent(?:er|re)", noun: "ศูนย์" },
];

/**
 * คำนามทั่วไปที่ยังเป็นภาษาอังกฤษ แปลว่าเราแปลไม่จบ
 *
 * ใช้ตรวจผลลัพธ์ก่อนส่งออก ถ้ายังเจอแปลว่าควร fallback ทั้งประโยค ดีกว่าปล่อย
 * ให้ผู้ใช้เห็นไทยชนอังกฤษครึ่งๆ กลางๆ
 */
const UNTRANSLATED_GENERIC =
  /\b(?:station|hub|port|cent(?:er|re)|warehouse|depot|facility|branch)\b/i;

export interface PlaceTranslation {
  text: string;
  /** false เมื่อยังมีคำนามทั่วไปภาษาอังกฤษค้างอยู่ = แปลไม่จบ */
  complete: boolean;
}

/**
 * แปลเฉพาะคำนามทั่วไปในชื่อสถานที่ คงชื่อเฉพาะไว้เหมือนเดิม
 *
 * รูปแบบ "คำนำหน้า :ชื่อ" จะสลับเป็น "คำนามไทย ชื่อ" ส่วนรูปแบบ "ชื่อ คำต่อท้าย"
 * ก็สลับมาไว้หน้าเช่นกัน เพราะภาษาไทยเรียง "ศูนย์คัดแยก Shenzhen"
 */
export function translatePlaceDetailed(place: string): PlaceTranslation {
  const trimmed = place.trim().replace(/^[:\-\s]+/, "").trim();

  for (const { pattern, noun } of PLACE_NOUNS) {
    // คำนามอยู่หน้า เช่น "station :ACRAI-B" หรือ "the origin port: SHENZHEN"
    const prefix = new RegExp(
      `^(?:the\\s+)?${pattern}\\b\\s*[:\\-]?\\s*(.*)$`,
      "i",
    ).exec(trimmed);
    if (prefix !== null) {
      const rest = prefix[1].trim().replace(/^[:\-\s]+/, "").trim();
      const text = rest === "" ? noun : `${noun} ${rest}`;
      return { text, complete: !UNTRANSLATED_GENERIC.test(rest) };
    }

    // คำนามอยู่ท้าย เช่น "Shenzhen sorting centre"
    const suffix = new RegExp(`^(.+?)\\s+${pattern}$`, "i").exec(trimmed);
    if (suffix !== null) {
      const name = suffix[1].trim();
      return { text: `${noun} ${name}`, complete: !UNTRANSLATED_GENERIC.test(name) };
    }
  }

  return { text: trimmed, complete: !UNTRANSLATED_GENERIC.test(trimmed) };
}

/** รูปแบบสั้นสำหรับที่ที่ไม่สนใจว่าแปลจบหรือไม่ */
export function translatePlace(place: string): string {
  return translatePlaceDetailed(place).text;
}

/**
 * กฎแปลประโยค
 *
 * เรียงจากเฉพาะเจาะจงไปกว้าง เพราะจะหยุดที่กฎแรกที่ตรง
 *
 * กฎที่จับชื่อสถานที่มาต่อท้ายจะคืน null เมื่อแปลชื่อนั้นไม่จบ (ยังมีคำนาม
 * ทั่วไปภาษาอังกฤษค้าง) เพื่อให้ผู้เรียกถอยไปใช้คำแปลของ tag หรือคืนต้นฉบับแทน
 * ปล่อยให้ผู้ใช้เห็น "ถึงstation :NORC-B" แบบไทยชนอังกฤษครึ่งๆ แย่กว่าเห็น
 * ประโยคอังกฤษเต็มที่อ่านแล้วเข้าใจได้
 */
const BODY_RULES: {
  pattern: RegExp;
  to: (match: RegExpExecArray) => string | null;
}[] = [
  {
    pattern: /^parcel has departed from\s*:?\s*(.+)$/i,
    to: (m) => withPlace("ออกจาก", m[1]),
  },
  {
    pattern: /^parcel (?:has )?departed\s+(?:from\s+)?station\s*:?\s*(.*)$/i,
    to: (m) => withPlace("ออกจาก", `station ${m[1]}`),
  },
  {
    pattern: /^parcel has arrived at\s*:?\s*(.+)$/i,
    to: (m) => withPlace("ถึง", m[1]),
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
  { pattern: /^delivery driver has been assigned$/i, to: () => "มอบหมายพนักงานนำจ่ายแล้ว" },
  { pattern: /^parcel has departed on flight$/i, to: () => "พัสดุขึ้นเครื่องแล้ว" },
  { pattern: /^parcel has arrived in destination country$/i, to: () => "ถึงประเทศปลายทางแล้ว" },
];

/**
 * ต่อคำกริยาไทยเข้ากับชื่อสถานที่ที่แปลแล้ว
 *
 * คืน null เมื่อแปลชื่อสถานที่ไม่จบ เพื่อบังคับให้ fallback ทั้งประโยค
 */
function withPlace(verb: string, rawPlace: string): string | null {
  const place = translatePlaceDetailed(rawPlace);
  if (!place.complete) return null;

  return place.text === "" ? verb : `${verb}${place.text}`;
}

/**
 * ใส่ช่องว่างคั่นตรงรอยต่อไทยกับละติน
 *
 * ภาษาไทยเขียนติดกันไม่เว้นวรรค แต่พอชนกับอักษรละตินแล้วอ่านยากมาก
 * ("ถึงสาขาACRAI-B") การเว้นวรรคตรงรอยต่อทำให้แยกคำออกได้ทันที
 */
function spaceThaiLatinBoundary(value: string): string {
  return value
    .replace(/([\u0E00-\u0E7F])([A-Za-z0-9])/g, "$1 $2")
    .replace(/([A-Za-z0-9])([\u0E00-\u0E7F])/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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

  const { tag, country, body } = parseStatusText(original);

  // ไปรษณีย์ไทยส่งภาษาไทยมาอยู่แล้ว ไม่ต้องยุ่ง — แต่ประโยคอังกฤษที่มี tag นำหน้า
  // อาจมีชื่อสถานที่ไทยปนอยู่ ("arrived at station :ACRAI-B - เมืองเชียงราย")
  // จึงเช็คเฉพาะข้อความที่ไม่มี tag เท่านั้น ไม่งั้นจะปล่อยประโยคอังกฤษหลุดไป
  if (tag === null && hasThai(original)) return original;

  let translated: string | null = null;

  for (const { pattern, to } of BODY_RULES) {
    const match = pattern.exec(body);
    if (match !== null) {
      translated = to(match);
      break;
    }
  }

  // แปลทั้งประโยคไม่ได้ (หรือแปลได้ไม่จบ) ลองใช้คำแปลของ tag แทน
  if (translated === null && tag !== null) {
    translated = TAG_TH[normalizeKey(tag)] ?? null;
  }

  // แปลไม่ได้เลยทั้งสองชั้น → คืนต้นฉบับ ดีกว่าให้เห็นไทยชนอังกฤษครึ่งๆ
  if (translated === null) return original;

  const countryTh =
    country === null ? null : (COUNTRY_TH[normalizeKey(country)] ?? country);

  const withCountry =
    countryTh === null ? translated : `${translated} (${countryTh})`;

  return spaceThaiLatinBoundary(withCountry);
}

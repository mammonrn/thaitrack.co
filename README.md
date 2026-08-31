# พัสดุไทย.com

เว็บติดตามพัสดุรวมหลายขนส่งในที่เดียว พิมพ์เลขพัสดุครั้งเดียวแล้วระบบไล่ถามให้ทุกเจ้า

สร้างด้วย [Next.js](https://nextjs.org) (App Router)

## เริ่มพัฒนา

```bash
cp .env.example .env.local   # แล้วใส่ค่าจริงในไฟล์
npm install
npm run dev
```

เปิด http://localhost:3000

## ตรวจก่อน commit

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## ตัวแปรสภาพแวดล้อม

ดูรายการทั้งหมดพร้อมคำอธิบายใน `.env.example`

ตัวแปรที่ขึ้นต้นด้วย `NEXT_PUBLIC_` **ถูกฝังลงไฟล์ JS ตอน `npm run build`** ไม่ได้อ่านตอน
runtime ถ้าเพิ่มหรือแก้ค่าเหล่านี้ต้อง build ใหม่เสมอ การ restart เฉยๆ ไม่มีผล

## ฐานข้อมูล (Supabase)

ไฟล์ SQL อยู่ใน `supabase/migrations/` รันครั้งเดียวตอนติดตั้ง ผ่าน SQL Editor
ของ Supabase dashboard หรือ `supabase db push` ถ้าใช้ CLI

`0001_saved_trackings.sql` สร้างตารางประวัติที่ผู้ใช้กดบันทึก พร้อมเปิด RLS และ
policy ครบทั้ง SELECT / INSERT / UPDATE / DELETE โดยผูกกับ `auth.uid() = user_id`

**ห้ามข้ามการเปิด RLS** เพราะเบราว์เซอร์ใช้ anon key ยิงเข้า PostgREST ได้โดยตรง
ถ้าไม่เปิด ผู้ใช้ที่ล็อกอินอยู่คนไหนก็อ่านและลบประวัติของคนอื่นได้ทั้งหมด

## ตรวจค่า environment variable

```bash
npm run check-env                        # เทียบค่าในไฟล์กับค่าที่โปรแกรมอ่านได้จริง
npm run check-env -- --call-thailand-post # ยิงขอ token จริงเทียบสองค่า
```

มีสองกรณีที่ทำให้ "curl ใช้ได้แต่แอปได้ 401" โดยที่แอปไม่ error ตอนอ่าน env
(ตัวแปรมีค่าอยู่ แค่เป็นค่าที่ผิด) และมองไม่เห็นจากการดูไฟล์เฉยๆ:

1. **ค่ามีเครื่องหมาย `$`** — Next ใช้ dotenv-expand ตีความว่าเป็นชื่อตัวแปรอื่น
   แล้วตัดตั้งแต่ `$` เป็นต้นไปทิ้ง (วัดจริง: ค่ายาว 17 ตัวอักษรเหลือ 3)
   แก้ด้วยการเขียนเป็น `\$` ในไฟล์

2. **มีค่าเดิมค้างอยู่ใน `process.env` แล้ว** — เช่น PM2 จำ env ตอนสร้าง process
   ไว้, มีใน `ecosystem.config.js` หรือ `export` ค้างใน shell **Next จะไม่เขียนทับ
   ค่าที่มีอยู่แล้ว** ไฟล์ `.env.local` จึงถูกมองข้ามทั้งไฟล์ และ `pm2 restart`
   ก็ไม่ช่วย เพราะค่ายังถูกส่งเข้ามาจากข้างนอกเหมือนเดิม

`npm run check-env` ตรวจทั้งสองกรณีนี้ให้ โดยแสดงแค่ความยาวกับ checksum ไม่พิมพ์
ค่าจริงของ key ออกมา

## เพดานการยิง Track123 และการอ่าน log

Track123 จำกัด **5 request/วินาที ต่อ endpoint** เกินแล้วตอบ code `A0706` กลับมา
ผู้ใช้แค่ 3–4 คนก็ชนได้ เพราะการค้นหา 1 ครั้งอาจยิงหลายครั้ง (ระบุขนส่ง + ตรวจจับเอง +
ลองซ้ำ) สี่ชั้นที่กันไว้:

| ชั้น | ไฟล์ | ทำอะไร |
| --- | --- | --- |
| เดาขนส่งจาก prefix | `lib/carriers/courier-prefix.ts` | เลขขึ้นต้น `SPXTH` ข้ามไปรษณีย์ไทย ยิงตรงไป `shopee-xpress-th` ประหยัด 1 call และเร็วขึ้น 1 รอบ |
| รวมคำขอซ้ำ | `lib/inflight.ts` | เลขเดียวกันที่กำลังรอผลอยู่แชร์ promise เดียวกัน ไม่ยิงซ้ำ |
| คิวจำกัดอัตรา | `lib/rate-limit-queue.ts` | ยิงได้ไม่เกิน 3 ครั้ง/วินาที ที่เกินเข้าแถวรอ ไม่ถูกทิ้ง |
| ลองใหม่อัตโนมัติ | `lib/carriers/track123-gateway.ts` | เจอ `A0706` แล้วหน่วง 500ms → 1s → 2s ก่อนยอมแพ้ |

ผู้ใช้จะเห็นข้อความ "คิวค้นหาหนาแน่น" ก็ต่อเมื่อทั้งสี่ชั้นเอาไม่อยู่ ระหว่างที่ยัง
รอคิวอยู่หน้าเว็บยังแสดงสถานะกำลังค้นหาตามปกติ

เลขที่ prefix ฟันธงว่าเป็นขนส่งเจ้าอื่น **ข้ามไปรษณีย์ไทยไปเลย** เพราะเลขทรงนั้น
ไม่มีทางอยู่ในระบบไปรษณีย์ไทย ส่วนเลขที่ prefix ไม่ฟันธงยังถามไปรษณีย์ไทยก่อนตามเดิม
(ฟรีและไม่จำกัดจำนวนครั้ง)

การเพิ่ม prefix เจ้าใหม่ทำได้ด้วยการเติมแถวใน `COURIER_PREFIXES` แถวเดียว —
เกณฑ์ที่ต้องผ่านก่อนเติมอยู่ในหัวไฟล์นั้น และต้องเข้มเป็นพิเศษ เพราะแถวที่ผิดแปลว่า
เลขกลุ่มนั้นจะไม่ถูกถามไปรษณีย์ไทยอีกเลย

### นับจำนวนการยิงจริงจาก pm2

ทุก request ที่ออกไปหา Track123 จริงถูกเขียนเป็น log บรรทัดเดียว:

```
[track123] ts=1756531234567 no=SPXTH046012345678 courier=shopee-xpress-th attempt=1/4 queued=3 wait=334ms took=287ms result=rate_limited upstream=A0706
```

- `queued` — มีคำขออัดอยู่ในคิวกี่ตัว ณ ตอนที่ตัวนี้เข้าคิว (`1` = คิวว่าง)
- `wait` — รอคิวกี่ ms ก่อนได้ยิง
- `attempt=n/4` — ยิงเป็นครั้งที่เท่าไรของคำขอนั้น (รวมรอบที่ลองใหม่)
- `result` — `ok` หรือสาเหตุที่พลาด, `upstream` คือ code ดิบของ Track123

```bash
pm2 logs --nostream --lines 5000 | grep -c '\[track123\]'        # ยิงไปทั้งหมดกี่ครั้ง
pm2 logs --nostream --lines 5000 | grep 'result=rate_limited'    # ชนลิมิตตอนไหนบ้าง
pm2 logs --nostream --lines 5000 | grep '\[track123\]' | grep -v 'queued=1 '   # จังหวะที่คิวอัดกัน
```

## Cache ผลติดตามพัสดุ (สองชั้น)

```
คำค้นเข้ามา → ชั้น 1 memory → ชั้น 2 Supabase → ยิง API จริง
                  ↑ เร็วสุด        ↑ รอด restart      ↓
                  └────────── เขียนกลับทั้งสองชั้น ────┘
```

| ชั้น | ไฟล์ | รอด restart | ใช้ร่วมทุก instance |
| --- | --- | --- | --- |
| 1. memory | `lib/cache.ts` | ✗ | ✗ |
| 2. Supabase | `lib/supabase/tracking-cache.ts` | ✓ | ✓ |

ตัวประกอบสองชั้นอยู่ที่ `lib/tracking-cache.ts`

โควตาของ Track123 นับเป็น **จำนวนเลขพัสดุต่อรอบบิล ไม่ใช่จำนวน request** การยิงเลขเดิม
ซ้ำจึงไม่เสียโควตาเพิ่ม เป้าหมายของ cache คือลดจำนวน request (เพดาน 5 req/s) ลดเวลารอ
ของผู้ใช้ และมีของสำรองไว้แสดงในวันที่ระบบขนส่งล่ม

### TTL ตามสถานะ

| สถานะ | TTL | เหตุผล |
| --- | --- | --- |
| `delivered` | 30 วัน | ถึงมือผู้รับแล้ว ไม่มีทางเปลี่ยนอีก |
| `exception` | 3 ชั่วโมง | ไม่ใช่สถานะจบจริง — "นำจ่ายไม่สำเร็จ" มักถูกส่งใหม่วันถัดไป |
| `pending` / `in_transit` | 2 ชั่วโมง | ขยับเป็นช่วงๆ |
| `out_for_delivery` | 15 นาที | เปลี่ยนได้ทุกนาที และเป็นช่วงที่ผู้ใช้เช็คถี่สุด |

แก้ที่ `TTL_MS` ใน `lib/cache.ts` ที่เดียว

### วันที่ระบบขนส่งล่ม

ถ้ายิง API ไม่สำเร็จเพราะ **ระบบมีปัญหา** (ขนส่งล่ม, โควตาหมด, ชนลิมิตจนเอาไม่อยู่)
แต่มีข้อมูลเก่าค้างใน cache ระบบจะแสดงข้อมูลเก่านั้นพร้อมป้าย "ระบบขนส่งไม่ตอบตอนนี้"
และเวลาที่ดึงข้อมูลมา — ผู้ใช้ได้คำตอบ ไม่ใช่หน้าจอ error

`not_found` กับ `invalid_tracking_number` **ไม่** เข้าเงื่อนไขนี้ เพราะเป็นคำตอบจริงที่
ผู้ใช้ต้องได้เห็น ถ้าเอาข้อมูลเก่ามาบัง พัสดุที่หลุดออกจากระบบขนส่งไปแล้วจะดูเหมือน
ยังตามได้อยู่ตลอดกาล

### ความปลอดภัยของตาราง

ตาราง `public.tracking_cache` เป็น **ของกลาง ไม่มีคอลัมน์ `user_id` และห้ามเพิ่ม** —
ถ้าเก็บว่าใครค้นเลขอะไร ตารางจะกลายเป็นบันทึกพฤติกรรมผู้ใช้ทันที

เข้าถึงได้จากฝั่งเซิร์ฟเวอร์ด้วย service role key เท่านั้น กันไว้สามชั้น:

1. `revoke all` จาก `anon` และ `authenticated` ในไฟล์ migration
2. เปิด RLS ไว้โดย **ไม่มี policy เลย** — Postgres ปฏิเสธทุกแถวเป็นค่าเริ่มต้น
3. เทสต์ใน `lib/supabase/tracking-cache.test.ts` อ่านซอร์สจริงแล้วยืนยันว่าไม่มี
   client component ไหน import ไฟล์ที่ถือ key และมีไฟล์เดียวที่แตะชื่อตาราง

## นับ cache hit rate จาก pm2

log สองชนิดที่คู่กัน:

| log | หนึ่งบรรทัดต่อ |
| --- | --- |
| `[track]` | หนึ่งการค้นหาของผู้ใช้ ไม่ว่าจะได้คำตอบจากชั้นไหน |
| `[track123]` | หนึ่ง request ที่ออกไปหา Track123 จริง |

```
[track] ts=1756531234567 no=EY145587896TH route=track source=memory stale=no shared=no took=3ms
[track] ts=1756531240120 no=SPXTH046012345678 route=track source=supabase stale=yes shared=no took=1503ms reason=rate_limited
```

- `source` — `memory` / `supabase` / `api` / `error`
- `stale=yes` — แสดงข้อมูลเก่าเพราะยิงของสดไม่สำเร็จ
- `route` — `track` (หน้าค้นหา) หรือ `saved` (กดบันทึกประวัติ)

```bash
L='pm2 logs --nostream --lines 20000'

$L | grep -c '\[track\] '                    # ค้นหาทั้งหมดกี่ครั้ง
$L | grep -c 'source=memory'                 # จบที่ชั้น memory
$L | grep -c 'source=supabase'               # จบที่ชั้น Supabase
$L | grep -c 'source=api'                    # ต้องยิง API จริง
$L | grep -c 'stale=yes'                     # ต้องใช้ข้อมูลสำรอง (ขนส่งมีปัญหา)
```

hit rate = `(memory + supabase) / ทั้งหมด` — ถ้าตัวเลข `source=api` ยังสูงหลังใช้งาน
ไปสักพัก แปลว่า TTL สั้นเกินไปสำหรับสถานะที่ถูกค้นบ่อย

## Deploy หลัง Nginx

session ของ Supabase ถูกเก็บใน cookie ที่ใหญ่กว่าปกติมาก (JWT + ข้อมูลผู้ใช้จาก Google
รวมแล้วประมาณ 4–6 KB ถูกหั่นเป็นหลายก้อน ก้อนละไม่เกิน 3180 bytes) ตอนเข้าสู่ระบบสำเร็จ
`/auth/callback` จะตอบกลับมาพร้อม `Set-Cookie` หลายอันรวมกันเกิน 4 KB

ค่าเริ่มต้นของ Nginx (`proxy_buffer_size` 4k) เล็กเกินกว่าจะรับ response header ขนาดนั้น
ผลคือ Nginx ตอบ **502 Bad Gateway ทันที** และ log ของแอพจะไม่มี error อะไรเลย เพราะฝั่งแอพ
ตอบถูกต้อง แต่ Nginx เป็นฝ่ายปฏิเสธเอง (ใน `/var/log/nginx/error.log` จะเห็นข้อความ
`upstream sent too big header`)

ต้องขยาย buffer ใน server block:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP         $remote_addr;

    # จำเป็นสำหรับ cookie ของ Supabase ค่าเริ่มต้น 4k เล็กเกินไปทำให้เกิด 502
    proxy_buffer_size       16k;
    proxy_buffers        8  16k;
    proxy_busy_buffers_size 32k;
}
```

`X-Forwarded-Host` กับ `X-Forwarded-Proto` จำเป็นด้วย ไม่งั้น `/auth/callback` จะ redirect
ผู้ใช้กลับไปที่อยู่ภายในของเครื่องแทนที่จะเป็นโดเมนจริง

ทุกการเรียก Supabase ตั้งเพดานเวลาไว้ที่ 8 วินาที (`lib/supabase/fetch.ts`) เพื่อไม่ให้
request ค้างรอจนโดน reverse proxy ตัดแล้วกลายเป็น 502/504 โดยไม่มีร่องรอยใน log

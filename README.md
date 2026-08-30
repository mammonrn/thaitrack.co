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
| เดาขนส่งจาก prefix | `lib/carriers/courier-prefix.ts` | เลขขึ้นต้น `SPXTH` ยิงตรงไป `shopee-xpress-th` ประหยัด 1 call ต่อการค้นหา |
| รวมคำขอซ้ำ | `lib/inflight.ts` | เลขเดียวกันที่กำลังรอผลอยู่แชร์ promise เดียวกัน ไม่ยิงซ้ำ |
| คิวจำกัดอัตรา | `lib/rate-limit-queue.ts` | ยิงได้ไม่เกิน 3 ครั้ง/วินาที ที่เกินเข้าแถวรอ ไม่ถูกทิ้ง |
| ลองใหม่อัตโนมัติ | `lib/carriers/track123-gateway.ts` | เจอ `A0706` แล้วหน่วง 500ms → 1s → 2s ก่อนยอมแพ้ |

ผู้ใช้จะเห็นข้อความ "คิวค้นหาหนาแน่น" ก็ต่อเมื่อทั้งสี่ชั้นเอาไม่อยู่ ระหว่างที่ยัง
รอคิวอยู่หน้าเว็บยังแสดงสถานะกำลังค้นหาตามปกติ

การเพิ่ม prefix เจ้าใหม่ทำได้ด้วยการเติมแถวใน `COURIER_PREFIXES` แถวเดียว —
เกณฑ์ที่ต้องผ่านก่อนเติมอยู่ในหัวไฟล์นั้น

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

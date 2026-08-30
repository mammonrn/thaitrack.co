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

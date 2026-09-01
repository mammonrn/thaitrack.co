import type { Metadata } from "next";
import Link from "next/link";

import { CARRIER_LANDINGS } from "@/lib/carriers/landing";
import { absoluteUrl } from "@/lib/site";
import SiteHeader from "./site-header";
import TrackingSearch from "./tracking-search";

/** ขนส่งที่เขียนไว้ใต้ช่องกรอก — ชื่อที่คนไทยเรียกกันจริง */
const CARRIERS = [
  "ไปรษณีย์ไทย",
  "Flash Express",
  "Kerry Express",
  "J&T Express",
  "SPX Express",
];

export const metadata: Metadata = {
  title: "เช็คพัสดุทุกขนส่งในที่เดียว — พัสดุไทย.com",
  description:
    "พิมพ์เลขพัสดุครั้งเดียว เราไล่ถามให้ทุกขนส่ง ไปรษณีย์ไทย Flash Kerry J&T SPX และอื่นๆ ฟรี ไม่ต้องสมัครสมาชิก",
  alternates: { canonical: absoluteUrl("/") },
};

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        <TrackingSearch
          title="พัสดุถึงไหนแล้ว"
          intro="พิมพ์เลขพัสดุครั้งเดียว เราไล่ถามให้ทุกขนส่ง ไม่ต้องจำว่าส่งมาจากเจ้าไหน"
          footnote={`${CARRIERS.join(" · ")} และอื่นๆ`}
        />

        {/*
          ลิงก์ไปหน้า landing รายขนส่ง — มีสองเหตุผลที่ต้องอยู่บนหน้าแรก
          1. คนที่รู้อยู่แล้วว่าพัสดุเป็นของเจ้าไหน ได้หน้าที่ตรงกับที่เขาหา
          2. crawler เดินเข้าไปเจอหน้าพวกนั้นได้จริง — sitemap อย่างเดียวไม่พอ
             Google ใช้ลิงก์ภายในตัดสินว่าหน้าไหนสำคัญแค่ไหนด้วย
        */}
        <section className="border-t border-line px-4 py-10 sm:px-6 sm:py-14">
          <div className="mx-auto w-full max-w-2xl">
            <h2 className="font-display text-lg font-semibold text-ink sm:text-xl">
              เช็คพัสดุแยกตามขนส่ง
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-faint">
              รู้อยู่แล้วว่าเป็นของเจ้าไหน กดเข้าหน้าของเจ้านั้นได้เลย
              มีตัวอย่างรูปแบบเลขพัสดุกับคำถามที่พบบ่อยของแต่ละเจ้าอยู่ในนั้น
            </p>

            <ul className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {CARRIER_LANDINGS.map((carrier) => (
                <li key={carrier.slug}>
                  <Link
                    href={`/${carrier.slug}`}
                    className="flex min-h-12 items-center rounded-xl border border-line bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:border-line-strong"
                  >
                    {carrier.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

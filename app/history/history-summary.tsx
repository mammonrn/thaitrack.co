import { SUMMARY_LABEL, type SavedSummary } from "@/lib/saved-trackings";

interface HistorySummaryProps {
  summary: SavedSummary;
}

interface Figure {
  label: string;
  value: number;
  /** สีของตัวเลข ใช้โทนเดียวกับสถานะบนการ์ดผลลัพธ์ */
  className: string;
}

/**
 * แถบตัวเลขสรุปเหนือรายการที่บันทึกไว้
 *
 * นับจาก snapshot สถานะที่เก็บไว้ตอนกดบันทึก ไม่ยิงถามขนส่งใหม่ ตัวเลขจึงตรงกับ
 * สถานะที่การ์ดแต่ละใบด้านล่างแสดงอยู่เสมอ ไม่ขัดกันเอง
 *
 * ช่อง "พัสดุมีปัญหา" โผล่เฉพาะตอนมีจริง เพราะปกติเป็นศูนย์ ถ้าโชว์ตลอดเวลาจะกิน
 * พื้นที่ไปเฉยๆ แต่ถ้ามีขึ้นมาแล้วไม่บอก ผู้ใช้จะงงว่าทำไมสองช่องแรกบวกกันไม่ครบ
 */
export default function HistorySummary({ summary }: HistorySummaryProps) {
  const figures: Figure[] = [
    { label: SUMMARY_LABEL.inTransit, value: summary.inTransit, className: "text-ink" },
    { label: SUMMARY_LABEL.delivered, value: summary.delivered, className: "text-ok" },
  ];

  if (summary.problem > 0) {
    figures.push({
      label: SUMMARY_LABEL.problem,
      value: summary.problem,
      className: "text-seal",
    });
  }

  figures.push({
    label: SUMMARY_LABEL.total,
    value: summary.total,
    className: "text-ink",
  });

  return (
    <dl className="mt-4 flex divide-x divide-line overflow-hidden rounded-xl border border-line bg-white">
      {figures.map(({ label, value, className }) => (
        <div key={label} className="flex-1 px-3 py-3.5 text-center sm:px-4">
          <dd
            className={`font-display text-2xl font-bold leading-none tabular-nums ${className}`}
          >
            {value}
          </dd>
          <dt className="mt-1.5 text-[11px] leading-tight text-faint sm:text-xs">
            {label}
          </dt>
        </div>
      ))}
    </dl>
  );
}

"use client";

/**
 * ตารางกรอกพิกัดสาขา — ออกแบบให้ใช้จากมือถือเป็นหลัก
 *
 * แต่ละสาขาเป็นการ์ดที่กางฟอร์มออกมาในตัวเอง ไม่ใช่ตารางที่ต้องเลื่อนแนวนอน
 * ช่องพิกัดใช้ inputMode="decimal" เพื่อให้คีย์บอร์ดมือถือขึ้นแป้นตัวเลขให้เลย
 *
 * ⚠️ การตรวจในไฟล์นี้เป็นแค่ความสะดวกของผู้กรอก ไม่ใช่การป้องกัน
 * ฝั่งเซิร์ฟเวอร์ (app/api/admin/branches/route.ts) ตรวจชุดเดียวกันเองอีกรอบ
 * และเป็นด่านที่นับจริง
 */

import { useState } from "react";

import {
  COORDINATE_ERROR_TEXT,
  OUTSIDE_THAILAND_WARNING,
  checkCoordinates,
} from "@/lib/coordinates";
import type { CarrierBranch, UnknownBranch } from "@/lib/supabase/locations";

interface BranchesEditorProps {
  unknown: UnknownBranch[];
  known: CarrierBranch[];
}

/** สิ่งที่ฟอร์มหนึ่งใบต้องรู้ ไม่ว่าจะมาจากรายการไหน */
interface EditableBranch {
  carrierCode: string;
  branchCode: string;
  branchName: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
  /** จำนวนครั้งที่เจอ — มีเฉพาะสาขาที่ยังไม่มีพิกัด */
  hitCount: number | null;
  /** สิ่งที่จดไว้เป็นอะไร — มีเฉพาะสาขาที่ยังไม่มีพิกัด */
  kind: string | null;
}

/**
 * คำอธิบายของแต่ละชนิด
 *
 * ตารางนี้ไม่ได้มีแต่รหัสสาขาแล้ว ตั้งแต่เริ่มจดทุกกรณีที่จบด้วย "ไม่มีแผนที่"
 * ถ้าไม่บอกว่าแต่ละแถวเป็นแบบไหน คนกรอกจะงงว่าทำไมมีข้อความไทยยาวๆ ปนอยู่กับ
 * รหัสสาขา และจะไม่รู้ว่าควรกรอกพิกัดของอะไรกันแน่
 */
const KIND_LABEL: Record<string, string> = {
  branch: "รหัสสาขา",
  address: "ที่อยู่ที่หาพิกัดไม่เจอ",
  unknown: "ข้อความที่อ่านไม่ออก",
};

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; warning: string | null }
  | { kind: "failed"; message: string };

const rowKey = (branch: { carrierCode: string; branchCode: string }) =>
  `${branch.carrierCode}::${branch.branchCode}`;

export default function BranchesEditor({ unknown, known }: BranchesEditorProps) {
  // สาขาที่เพิ่งบันทึกไป ย้ายออกจากรายการ "ยังไม่มีพิกัด" ทันที ไม่ต้องโหลดหน้าใหม่
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  const pending = unknown
    .filter((branch) => !savedKeys.has(rowKey(branch)))
    .map<EditableBranch>((branch) => ({
      carrierCode: branch.carrierCode,
      branchCode: branch.branchCode,
      branchName: branch.branchName,
      lat: null,
      lng: null,
      note: null,
      hitCount: branch.hitCount,
      kind: branch.kind,
    }));

  const done = known.map<EditableBranch>((branch) => ({
    carrierCode: branch.carrierCode,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    lat: branch.lat,
    lng: branch.lng,
    note: branch.note,
    hitCount: null,
    kind: null,
  }));

  return (
    <div className="mt-8 flex flex-col gap-10">
      <section>
        <h2 className="font-display text-lg font-semibold text-ink">
          ยังไม่มีพิกัด
          <span className="ml-2 font-mono text-xs font-normal text-faint">
            {pending.length} สาขา
          </span>
        </h2>
        <p className="mt-1 text-xs text-faint">เรียงจากที่ผู้ใช้เจอบ่อยที่สุดก่อน</p>

        {pending.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-line-strong p-5 text-center text-sm text-faint">
            ไม่มีสาขาที่รอเติมพิกัด
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {pending.map((branch) => (
              <BranchCard
                key={rowKey(branch)}
                branch={branch}
                onSaved={() =>
                  setSavedKeys((previous) =>
                    new Set(previous).add(rowKey(branch)),
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold text-ink">
          มีพิกัดแล้ว
          <span className="ml-2 font-mono text-xs font-normal text-faint">
            {done.length} สาขา
          </span>
        </h2>
        <p className="mt-1 text-xs text-faint">แก้พิกัดที่ใส่ผิดได้จากที่นี่</p>

        {done.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-line-strong p-5 text-center text-sm text-faint">
            ยังไม่เคยกรอกพิกัดสาขาไหนเลย
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {done.map((branch) => (
              <BranchCard key={rowKey(branch)} branch={branch} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BranchCard({
  branch,
  onSaved,
}: {
  branch: EditableBranch;
  onSaved?: () => void;
}) {
  const [lat, setLat] = useState(branch.lat === null ? "" : String(branch.lat));
  const [lng, setLng] = useState(branch.lng === null ? "" : String(branch.lng));
  const [name, setName] = useState(branch.branchName ?? "");
  const [note, setNote] = useState(branch.note ?? "");
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind === "saving") return;

    // ตรวจก่อนยิงเพื่อให้ผู้กรอกรู้ผลทันทีโดยไม่ต้องรอเครือข่าย
    // เซิร์ฟเวอร์ตรวจซ้ำเองอยู่แล้ว ตรงนี้จึงเป็นแค่ความสะดวก
    const checked = checkCoordinates(lat, lng);
    if (!checked.ok) {
      setState({ kind: "failed", message: COORDINATE_ERROR_TEXT[checked.reason] });
      return;
    }

    setState({ kind: "saving" });

    try {
      const response = await fetch("/api/admin/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrierCode: branch.carrierCode,
          branchCode: branch.branchCode,
          branchName: name,
          note,
          lat: checked.lat,
          lng: checked.lng,
        }),
      });

      const payload: unknown = await response.json().catch(() => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

      if (!response.ok) {
        setState({ kind: "failed", message });
        return;
      }

      const warning =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { warning?: unknown }).warning === "string"
          ? (payload as { warning: string }).warning
          : checked.outsideThailand
            ? OUTSIDE_THAILAND_WARNING
            : null;

      setState({ kind: "saved", warning });
      onSaved?.();
    } catch {
      setState({
        kind: "failed",
        message: "เชื่อมต่อไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองอีกครั้ง",
      });
    }
  }

  return (
    <li className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-paper/60 px-4 py-3">
        <span className="font-mono text-sm font-semibold text-ink">
          {branch.branchCode}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
          {branch.carrierCode}
        </span>
        {branch.kind !== null && branch.kind !== "branch" && (
          <span className="rounded-full border border-line-strong px-2 py-0.5 text-[11px] text-faint">
            {KIND_LABEL[branch.kind] ?? branch.kind}
          </span>
        )}
        {branch.hitCount !== null && (
          <span className="ml-auto text-xs text-faint">
            เจอ {branch.hitCount.toLocaleString("th-TH")} ครั้ง
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
        <Field label="ชื่อสาขา (เว้นว่างได้)">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="เช่น เมืองเชียงราย"
            maxLength={200}
            className={FIELD_CLASS}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="ละติจูด">
            <input
              type="text"
              inputMode="decimal"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              placeholder="19.9105"
              required
              className={FIELD_CLASS}
            />
          </Field>
          <Field label="ลองจิจูด">
            <input
              type="text"
              inputMode="decimal"
              value={lng}
              onChange={(event) => setLng(event.target.value)}
              placeholder="99.8406"
              required
              className={FIELD_CLASS}
            />
          </Field>
        </div>

        <Field label="บันทึกช่วยจำ (เว้นว่างได้)">
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="เช่น ยืนยันจากหน้าเว็บของขนส่งแล้ว"
            maxLength={200}
            className={FIELD_CLASS}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={state.kind === "saving"}
            className="inline-flex h-11 items-center rounded-xl bg-ink px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-strong disabled:cursor-not-allowed disabled:bg-ink-busy"
          >
            {state.kind === "saving" ? "กำลังบันทึก…" : "บันทึกพิกัด"}
          </button>

          {state.kind === "saved" && (
            <span className="text-sm font-medium text-ok">บันทึกแล้ว</span>
          )}
        </div>

        {state.kind === "saved" && state.warning !== null && (
          <p className="text-sm leading-relaxed text-seal">{state.warning}</p>
        )}
        {state.kind === "failed" && (
          <p className="text-sm leading-relaxed text-seal">{state.message}</p>
        )}
      </form>
    </li>
  );
}

const FIELD_CLASS =
  "h-11 w-full rounded-xl border border-line-strong bg-white px-3 font-body text-base text-body outline-none transition-colors placeholder:text-faint/70 hover:border-ink/30 focus:border-ink";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-faint">{label}</span>
      {children}
    </label>
  );
}

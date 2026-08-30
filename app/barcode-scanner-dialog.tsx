"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { startScanning, type ScannerControls } from "@/lib/barcode-scan";
import { normalizeTrackingNumber } from "@/lib/carriers/resolve";

interface BarcodeScannerDialogProps {
  onClose: () => void;
  /** เรียกเมื่อได้เลขที่พร้อมค้นหาแล้ว */
  onDetected: (trackingNumber: string) => void;
}

type Phase =
  | { kind: "starting" }
  | { kind: "scanning" }
  | { kind: "confirming"; value: string }
  | { kind: "error"; title: string; detail: string };

/** รูปแบบเดียวกับที่ resolveTracking ยอมรับ ใช้ตัดสินว่าควรค้นหาทันทีหรือถามก่อน */
const TRACKING_PATTERN = /^[A-Z0-9]{6,40}$/;

function describeCameraError(error: unknown): { title: string; detail: string } {
  const name = error instanceof Error ? error.name : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      title: "ยังไม่ได้อนุญาตให้ใช้กล้อง",
      detail:
        "กดไอคอนรูปกุญแจหรือกล้องที่แถบที่อยู่เว็บ แล้วเลือกอนุญาต จากนั้นลองใหม่ หรือปิดหน้าต่างนี้แล้วพิมพ์เลขพัสดุเอง",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return {
      title: "ไม่พบกล้องที่ใช้ได้",
      detail: "เครื่องนี้อาจไม่มีกล้อง ปิดหน้าต่างนี้แล้วพิมพ์เลขพัสดุเองได้เลย",
    };
  }
  if (name === "NotReadableError") {
    return {
      title: "กล้องถูกใช้งานอยู่",
      detail:
        "มีแอพอื่นใช้กล้องอยู่ ปิดแอพนั้นก่อนแล้วลองใหม่ หรือพิมพ์เลขพัสดุเอง",
    };
  }

  return {
    title: "เปิดกล้องไม่สำเร็จ",
    detail: "ลองใหม่อีกครั้ง หรือปิดหน้าต่างนี้แล้วพิมพ์เลขพัสดุเอง",
  };
}

/**
 * กล่องสแกนบาร์โค้ด/QR
 *
 * เจ้าของ MediaStream อยู่ที่นี่ที่เดียว และปิดทุก track ตอน component ถูกถอด
 * ออกเสมอ ไม่ว่าจะปิดด้วยปุ่ม, Escape, คลิกนอกกล่อง หรือสแกนเจอ ไฟกล้องจึงไม่ค้าง
 *
 * ผู้เรียก mount component นี้เฉพาะตอนจะสแกน (ไม่ได้ส่ง prop open เข้ามา)
 * สถานะภายในจึงเริ่มใหม่ทุกครั้งที่เปิด ไม่มีค่าค้างจากรอบก่อน
 */
export default function BarcodeScannerDialog({
  onClose,
  onDetected,
}: BarcodeScannerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);

  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  /** เพิ่มค่าเพื่อสั่งให้ effect เปิดกล้องรอบใหม่ (ใช้ตอนกด "สแกนใหม่") */
  const [attempt, setAttempt] = useState(0);

  /** คืนกล้องและหยุดการอ่าน — เรียกซ้ำได้ไม่มีผลข้างเคียง */
  const releaseCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;

    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (!dialog.open) dialog.showModal();

    let cancelled = false;

    async function begin() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // กล้องหลังอ่านบาร์โค้ดได้ดีกว่า แต่ถ้าเครื่องไม่มีก็ให้ใช้ตัวที่มี
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });

        // ผู้ใช้ปิดกล่องระหว่างรอสิทธิ์ ต้องคืนกล้องทันทีไม่งั้นไฟกล้องค้าง
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        streamRef.current = stream;

        const video = videoRef.current;
        if (video === null) return;

        video.srcObject = stream;
        await video.play();

        if (cancelled) return;

        controlsRef.current = await startScanning(video, (value) => {
          releaseCamera();
          const normalized = normalizeTrackingNumber(value);

          // อ่านได้แต่หน้าตาไม่เหมือนเลขพัสดุ (เช่น QR ที่เป็นลิงก์เว็บ)
          // ต้องให้ผู้ใช้ยืนยันก่อน ไม่ยิงค้นหาเลย
          if (!TRACKING_PATTERN.test(normalized)) {
            setPhase({ kind: "confirming", value: normalized });
            return;
          }

          onDetected(normalized);
        });

        setPhase({ kind: "scanning" });
      } catch (error) {
        if (cancelled) return;
        console.error("[scan] เปิดกล้องไม่สำเร็จ:", error);
        releaseCamera();
        setPhase({ kind: "error", ...describeCameraError(error) });
      }
    }

    void begin();

    return () => {
      cancelled = true;
      releaseCamera();
    };
  }, [attempt, onDetected, releaseCamera]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleBackdropClick}
      aria-labelledby="scanner-title"
      className="m-auto h-[min(38rem,calc(100dvh-2rem))] w-[min(28rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-line-strong bg-paper p-0 text-body shadow-2xl backdrop:bg-ink/60"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2
            id="scanner-title"
            className="font-display text-base font-bold tracking-tight text-ink"
          >
            สแกนเลขพัสดุ
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างสแกน"
            className="-m-1 rounded-lg p-1.5 text-faint transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className="relative flex-1 bg-ink-strong">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
          />

          {phase.kind === "scanning" && (
            <>
              {/* กรอบเล็งให้ผู้ใช้รู้ว่าต้องวางบาร์โค้ดตรงไหน */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-8 top-1/2 h-36 -translate-y-1/2 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(14,35,64,0.45)]"
              />
              <p className="absolute inset-x-0 bottom-4 text-center text-sm text-white/90">
                วางบาร์โค้ดหรือ QR ให้อยู่ในกรอบ
              </p>
            </>
          )}

          {phase.kind === "starting" && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-white/90">
              กำลังเปิดกล้อง…
            </p>
          )}

          {phase.kind === "error" && (
            <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-paper p-6 text-center">
              <p className="font-display text-base font-bold text-seal">
                {phase.title}
              </p>
              <p className="text-sm leading-relaxed text-faint">{phase.detail}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 h-11 rounded-xl bg-ink px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-strong"
              >
                พิมพ์เลขเอง
              </button>
            </div>
          )}

          {phase.kind === "confirming" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-paper p-6 text-center">
              <p className="font-display text-base font-bold text-ink">
                อ่านได้ แต่ไม่เหมือนเลขพัสดุ
              </p>
              <p className="break-all font-mono text-sm text-body">
                {phase.value}
              </p>
              <p className="text-sm leading-relaxed text-faint">
                ต้องการใช้ค่านี้ค้นหาไหม
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setPhase({ kind: "starting" });
                    setAttempt((value) => value + 1);
                  }}
                  className="h-11 rounded-xl border border-line-strong bg-white px-5 text-sm font-medium text-ink transition-colors hover:bg-ink/5"
                >
                  สแกนใหม่
                </button>
                <button
                  type="button"
                  onClick={() => onDetected(phase.value)}
                  className="h-11 rounded-xl bg-ink px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-strong"
                >
                  ใช้ค่านี้
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

import BarcodeScannerDialog from "./barcode-scanner-dialog";

interface ScanButtonProps {
  /** เรียกเมื่อสแกนได้เลขที่พร้อมใช้ค้นหา */
  onDetected: (trackingNumber: string) => void;
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2L9 3.5h6L16.5 6h2A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.6" />
    </svg>
  );
}

/**
 * ปุ่มกล้องข้างช่องกรอกเลขพัสดุ
 *
 * ซ่อนตัวเองเมื่อเครื่องไม่มีกล้อง จะได้ไม่มีปุ่มที่กดแล้วเจอแต่ข้อความผิดพลาด
 */
export default function ScanButton({ onDetected }: ScanButtonProps) {
  const [hasCamera, setHasCamera] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function detectCamera() {
      if (!navigator.mediaDevices?.enumerateDevices) return;

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!isActive) return;
        // ก่อนได้รับสิทธิ์ ชื่ออุปกรณ์จะว่าง แต่ยังนับจำนวนได้ จึงเช็คแค่ชนิด
        setHasCamera(devices.some((device) => device.kind === "videoinput"));
      } catch (error) {
        console.error("[scan] อ่านรายชื่ออุปกรณ์ไม่สำเร็จ:", error);
      }
    }

    void detectCamera();

    return () => {
      isActive = false;
    };
  }, []);

  const handleDetected = useCallback(
    (trackingNumber: string) => {
      setIsOpen(false);
      onDetected(trackingNumber);
    },
    [onDetected],
  );

  if (!hasCamera) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="สแกนบาร์โค้ดหรือ QR บนพัสดุ"
        className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-faint transition-colors hover:bg-ink/5 hover:text-ink sm:right-2.5"
      >
        <CameraIcon className="h-5 w-5" />
      </button>

      {isOpen && (
        <BarcodeScannerDialog
          onClose={() => setIsOpen(false)}
          onDetected={handleDetected}
        />
      )}
    </>
  );
}

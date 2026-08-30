import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // รูปโปรไฟล์จากบัญชี Google — โดเมนเดียวที่ Google ใช้ส่งรูปผู้ใช้
      // ถ้าไม่ประกาศไว้ next/image จะโยน error ตอน render หน้าโปรไฟล์
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;

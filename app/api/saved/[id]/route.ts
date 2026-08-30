/**
 * DELETE /api/saved/[id] — ลบหนึ่งรายการออกจากประวัติ
 *
 * ไม่ต้องเช็คเจ้าของเองใน where เพราะ RLS ที่ฐานข้อมูลกันไว้แล้ว การลบ id ของ
 * คนอื่นจะไม่โดนแถวใดเลย (ทดสอบไว้ใน supabase/migrations)
 */

import { NextResponse } from "next/server";

import { SupabaseConfigError } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/saved/[id]">,
) {
  const { id } = await context.params;

  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      console.error(`[api/saved] ${error.message}`);
      return NextResponse.json(
        { ok: false as const, error: { code: "unavailable" } },
        { status: 503 },
      );
    }
    throw error;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) {
    return NextResponse.json(
      { ok: false as const, error: { code: "unauthenticated" } },
      { status: 401 },
    );
  }

  const { data, error } = await supabase
    .from("saved_trackings")
    .delete()
    .eq("id", id)
    .select("id");

  if (error !== null) {
    console.error(`[api/saved] ลบไม่สำเร็จ: ${error.message}`);
    return NextResponse.json(
      { ok: false as const, error: { code: "unknown" } },
      { status: 500 },
    );
  }

  // ไม่โดนแถวใดเลย = id ไม่มีจริง หรือเป็นของคนอื่นแล้ว RLS กันไว้ แยกสองกรณีนี้
  // ไม่ได้และไม่ควรแยก เพราะจะกลายเป็นบอกใบ้ว่า id นั้นมีอยู่จริงหรือไม่
  //
  // ที่ต้องตอบ 404 แทน 200 เพราะถ้าตอบสำเร็จทั้งที่ไม่ได้ลบอะไร หน้าประวัติจะ
  // เอารายการออกจากจอทั้งที่ยังอยู่ในฐานข้อมูล
  if (data === null || data.length === 0) {
    return NextResponse.json(
      { ok: false as const, error: { code: "not_found" } },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true as const });
}

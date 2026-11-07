import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ترويسات CORS للسماح بالاتصال من الواجهة الأمامية
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

/**
 * دالة حساب المسافة بين نقطتين جغرافيتين بالمتر باستخدام معادلة Haversine
 */
function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3 // نصف قطر الأرض بالمتر
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return Math.round(R * c)
}

serve(async (req: Request) => {
  // 1. التعامل مع طلبات فحص CORS (Preflight OPTIONS)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // التحقق من نوع الطلب
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "طريقة الطلب غير مدعومة." }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const body = await req.json()
    const { employee_code, device_id, token, location_id, lat, lng, accuracy } = body

    // 2. التحقق من اكتمال المعاملات الأساسية
    if (!employee_code || !device_id || !token || !location_id || lat === undefined || lng === undefined) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "بيانات الطلب غير مكتملة. تأكد من إرسال الرقم الوظيفي، الباركود، وإحداثيات GPS.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 3. تهيئة عميل Supabase بصلاحيات service_role لتنفيذ التحقق بأمان وتجاوز قيود RLS
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables")
      return new Response(
        JSON.stringify({
          success: false,
          error: "خطأ في تهيئة خادم Supabase (مفاتيح الخدمة غير مكتملة).",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })

    // 4. التحقق من وجود ونشاط الموظف (Employee Verification)
    const normalizedCode = String(employee_code).trim().toUpperCase()
    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("*")
      .eq("employee_code", normalizedCode)
      .single()

    if (empError || !employee) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `الرقم الوظيفي (${normalizedCode}) غير موجود في النظام. يرجى مراجعة إدارة الموارد البشرية.`,
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (!employee.is_active) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `حساب الموظف (${employee.name}) موقوف حالياً. لا يمكن تسجيل البصمة.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 5. التحقق الصارم من ربط الجهاز (Device Binding Verification)
    if (employee.device_status === "none" || !employee.device_id) {
      // أول دخول للموظف: حفظ الجهاز بحالة معلق بانتظار موافقة المدير
      await supabase
        .from("employees")
        .update({
          device_id: device_id,
          device_status: "pending",
          device_registered_at: new Date().toISOString(),
        })
        .eq("id", employee.id)

      return new Response(
        JSON.stringify({
          success: false,
          is_device_pending: true,
          error: `مرحباً ${employee.name}. تم تسجيل جهازك الجديد لأول مرة، يرجى انتظار موافقة مدير النظام لاعتماده قبل تسجيل البصمة.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (employee.device_status === "pending") {
      return new Response(
        JSON.stringify({
          success: false,
          is_device_pending: true,
          error: `طلب ربط هذا الجهاز ما زال بانتظار موافقة مدير النظام. يرجى التواصل مع مسؤول الفرع.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (employee.device_status === "approved" && employee.device_id !== device_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `هذا الحساب مربوط مسبقاً بهاتف آخر معتمد. لا يمكن تسجيل البصمة من جهاز مختلف (اتصل بالإدارة لفك الربط).`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 6. التحقق من صلاحية دقة GPS (GPS Accuracy Check)
    const userAccuracy = Number(accuracy) || 0
    if (userAccuracy > 100) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `إشارة الـ GPS ضعيفة وغير دقيقة (الدقة الحالية: ±${Math.round(userAccuracy)}م والحد المقبول 100م). يرجى الوقوف بالقرب من نافذة أو مكان مكشوف وتفعيل دقة الموقع العالية.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 7. التحقق من موقع العمل والمسافة الجغرافية (Geofence Verification)
    const { data: location, error: locError } = await supabase
      .from("locations")
      .select("*")
      .eq("id", location_id)
      .single()

    if (locError || !location) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "موقع العمل المحدد غير معرّف في النظام.",
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const distanceMeters = calculateHaversineDistance(
      Number(lat),
      Number(lng),
      location.lat,
      location.lng
    )

    if (distanceMeters > location.radius_m) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `أنت خارج نطاق موقع العمل المعتمد (${location.name}). أنت على بعد ${distanceMeters} متراً، والحد الأقصى المسموح به هو ${location.radius_m} متراً.`,
          distance: distanceMeters,
          radius: location.radius_m,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 8. التحقق من صلاحية رمز الباركود (QR Token Verification)
    const serverNow = new Date()
    const { data: qrRecord, error: qrError } = await supabase
      .from("qr_tokens")
      .select("*")
      .eq("token", token)
      .eq("location_id", location_id)
      .single()

    if (qrError || !qrRecord) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "رمز الباركود غير صالح أو لم يُنشأ لهذا الموقع. يرجى مسح الرمز المعروض على الشاشة.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (qrRecord.used) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "تم استخدام هذا الرمز من قبل! يرجى مسح الرمز الجديد المتجدد على الشاشة.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // التحقق من الوقت مع سماحية 5 ثوانٍ إضافية لحالات بطء الشبكة
    const expiresAt = new Date(qrRecord.expires_at)
    if (serverNow.getTime() > expiresAt.getTime()) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "انتهت صلاحية رمز الباركود (يتجدد كل 10 ثوانٍ). يرجى مسح الرمز الحالي على الشاشة.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // إبطال الرمز فوراً لمنع إعادة استخدامه من أي جهاز آخر (Concurrency Safe)
    await supabase
      .from("qr_tokens")
      .update({ used: true })
      .eq("token", token)

    // 9. تحديد نوع العملية (حضور أم انصراف تلقائياً حسب آخر حركة)
    const { data: lastAttendance } = await supabase
      .from("attendance")
      .select("type, created_at")
      .eq("employee_id", employee.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    // منع الحركات المتكررة السريعة (خلال 30 ثانية من نفس الموظف)
    if (lastAttendance) {
      const lastTime = new Date(lastAttendance.created_at).getTime()
      const diffSeconds = (serverNow.getTime() - lastTime) / 1000
      if (diffSeconds < 30) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `تم تسجيل بصمتك قبل قليل (${Math.round(diffSeconds)} ثانية). يرجى الانتظار دقيقة واحدة على الأقل قبل تسجيل بصمة جديدة.`,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    }

    // إذا كانت آخر حركة حضور (in)، تصبح الحركة الجديدة انصراف (out)، والعكس
    const nextType: "in" | "out" = lastAttendance?.type === "in" ? "out" : "in"

    // 10. تسجيل الحركة المعتمدة في جدول الحضور (Attendance Recording)
    const { data: newRecord, error: insertError } = await supabase
      .from("attendance")
      .insert([
        {
          employee_id: employee.id,
          location_id: location.id,
          type: nextType,
          lat: Number(lat),
          lng: Number(lng),
          accuracy: userAccuracy,
          created_at: serverNow.toISOString(),
        },
      ])
      .select()
      .single()

    if (insertError) {
      console.error("Failed to insert attendance record:", insertError)
      return new Response(
        JSON.stringify({
          success: false,
          error: "حدث خطأ غير متوقع أثناء حفظ سجل الحضور: " + insertError.message,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 11. إرجاع استجابة النجاح المعتمدة
    const typeArabic = nextType === "in" ? "تسجيل الحضور (دخول)" : "تسجيل الانصراف (خروج)"
    const timeFormatted = serverNow.toLocaleTimeString("ar-SA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    })

    return new Response(
      JSON.stringify({
        success: true,
        type: nextType,
        employee_name: employee.name,
        employee_code: employee.employee_code,
        location_name: location.name,
        timestamp: serverNow.toISOString(),
        message: `تم ${typeArabic} بنجاح للموظف (${employee.name}) في تمام الساعة ${timeFormatted}.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err: any) {
    console.error("Unexpected error in check-in edge function:", err)
    return new Response(
      JSON.stringify({
        success: false,
        error: "حدث خطأ غير متوقع في الخادم: " + (err.message || String(err)),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})


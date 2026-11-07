import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ترويسات CORS للسماح بالاتصال المباشر من الواجهة الأمامية بدون قيود
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
    const { 
      employee_code, 
      device_id, 
      token, 
      location_id, 
      lat, 
      lng, 
      accuracy, 
      method = (token ? 'qr' : 'gps') 
    } = body

    // 2. التحقق من اكتمال المعاملات الأساسية للموظف والجهاز
    if (!employee_code || !device_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "بيانات الطلب غير مكتملة (يرجى توفير الرقم التعريفي ومعرّف الجهاز).",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 3. تهيئة عميل Supabase بصلاحيات service_role (لتخطي قيود RLS وتنفيذ البصمة بأمان بدون JWT مستخدم)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
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
      .maybeSingle()

    if (empError || !employee) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `الرقم الوظيفي (${normalizedCode}) غير موجود في النظام. يرجى مراجعة الإدارة.`,
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (!employee.is_active) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `حساب الموظف (${employee.name}) موقوف حالياً من قبل الإدارة.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 5. التحقق الصارم من ربط الجهاز (Device Binding Verification)
    const serverNow = new Date()

    if (employee.device_status === "none" || !employee.device_id) {
      // أول دخول للموظف: حفظ الجهاز بحالة معلق بانتظار موافقة المدير
      await supabase
        .from("employees")
        .update({
          device_id: device_id,
          device_status: "pending",
          device_registered_at: serverNow.toISOString(),
        })
        .eq("id", employee.id)

      return new Response(
        JSON.stringify({
          success: false,
          is_device_pending: true,
          error: `مرحباً ${employee.name}. تم تسجيل هاتفك لأول مرة، يرجى انتظار موافقة مدير النظام لاعتماده قبل تسجيل البصمة.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (employee.device_status === "pending") {
      return new Response(
        JSON.stringify({
          success: false,
          is_device_pending: true,
          error: `طلب ربط هذا الجهاز ما زال بانتظار موافقة مدير النظام. يرجى مراجعة الإدارة.`,
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

    // جلب موقع العمل الأساسي إذا لم يُمرر
    let targetLocationId = location_id
    if (!targetLocationId) {
      const { data: defaultLoc } = await supabase
        .from("locations")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
      targetLocationId = defaultLoc?.id
    }

    const { data: location, error: locError } = await supabase
      .from("locations")
      .select("*")
      .eq("id", targetLocationId)
      .maybeSingle()

    if (locError || !location) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "موقع العمل المحدد غير معرّف في النظام.",
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // =========================================================================
    // الطريقة الأولى: البصمة عبر مسح الباركود (QR Code Scan)
    // لا تتطلب فحص موقع GPS لأن الباركود لا يتواجد إلا داخل المقر ويتجدد كل 10 ثوانٍ
    // =========================================================================
    if (method === 'qr' || (token && String(token).trim() !== '')) {
      if (!token || String(token).trim() === '') {
        return new Response(
          JSON.stringify({ success: false, error: "يرجى مسح رمز الباركود المعروض على الشاشة." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      // التحقق من صلاحية رمز الباركود
      const { data: qrRecord, error: qrError } = await supabase
        .from("qr_tokens")
        .select("*")
        .eq("token", String(token).trim())
        .maybeSingle()

      if (qrError || !qrRecord) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "رمز الباركود غير صالح أو لم يُنشأ من خادم النظام.",
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

      // إبطال الرمز فوراً لمنع تكراره
      await supabase
        .from("qr_tokens")
        .update({ used: true })
        .eq("token", qrRecord.token)

    // =========================================================================
    // الطريقة الثانية: البصمة عبر الموقع الجغرافي (GPS Geofence)
    // تتطلب فحص تواجد الموظف داخل دائرة الموقع مع دقة GPS مقبولة (حتى 300م)
    // =========================================================================
    } else {
      if (lat === undefined || lng === undefined || lat === null || lng === null) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "إحداثيات الموقع الجغرافي غير متوفرة. يرجى تفعيل الـ GPS في هاتفك والمحاولة مجدداً.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      // التحقق من دقة إشارة GPS (الحد الأقصى 300م ليناسب المباني وتجارب المتصفح)
      const userAccuracy = Number(accuracy) || 0
      if (userAccuracy > 300) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `إشارة الـ GPS ضعيفة جداً (الدقة الحالية: ±${Math.round(userAccuracy)}م والحد الأقصى المقبول 300م). يرجى التواجد في مكان مكشوف أو تفعيل دقة الموقع العالية.`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      // حساب المسافة الحقيقية بالمتر
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
    }

    // 6. تحديد نوع العملية (حضور أم انصراف تلقائياً)
    const { data: lastAttendance } = await supabase
      .from("attendance")
      .select("type, created_at")
      .eq("employee_id", employee.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    // منع الحركات المتكررة السريعة خلال 30 ثانية
    if (lastAttendance) {
      const lastTime = new Date(lastAttendance.created_at).getTime()
      const diffSeconds = (serverNow.getTime() - lastTime) / 1000
      if (diffSeconds < 30) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `تم تسجيل بصمتك قبل قليل (${Math.round(diffSeconds)} ثانية). يرجى الانتظار 30 ثانية قبل تسجيل بصمة جديدة.`,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    }

    const nextType: "in" | "out" = lastAttendance?.type === "in" ? "out" : "in"
    const punchMethodUsed = method === 'gps' ? 'gps' : 'qr'

    // 7. تسجيل الحركة في جدول الحضور
    const { data: newRecord, error: insertError } = await supabase
      .from("attendance")
      .insert([
        {
          employee_id: employee.id,
          location_id: location.id,
          type: nextType,
          method: punchMethodUsed,
          lat: lat !== undefined && lat !== null ? Number(lat) : location.lat,
          lng: lng !== undefined && lng !== null ? Number(lng) : location.lng,
          accuracy: accuracy ? Number(accuracy) : 10,
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

    // 8. إرجاع استجابة النجاح
    const typeArabic = nextType === "in" ? "تسجيل الحضور (دخول)" : "تسجيل الانصراف (خروج)"
    const methodArabic = punchMethodUsed === 'gps' ? 'بصمة الموقع الجغرافي GPS' : 'مسح باركود الشاشة QR'
    const timeFormatted = serverNow.toLocaleTimeString("ar-SA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })

    return new Response(
      JSON.stringify({
        success: true,
        type: nextType,
        method: punchMethodUsed,
        employee_name: employee.name,
        employee_code: employee.employee_code,
        location_name: location.name,
        timestamp: serverNow.toISOString(),
        message: `تم ${typeArabic} بنجاح للموظف (${employee.name}) عبر (${methodArabic}) في تمام الساعة ${timeFormatted}.`,
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

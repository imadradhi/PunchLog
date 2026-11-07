import { supabase } from './supabase'

/**
 * دالة استدعاء تسجيل البصمة الموحدة
 * تحاول استدعاء Edge Function (check-in) في الخادم، وإذا لم تكن منشورة بعد،
 * تستدعي دالة الخادم الآمنة (check_in_rpc) كبديل متطابق تماماً في التحقق.
 */
export async function submitCheckIn({
  employee_code,
  device_id,
  token,
  location_id,
  lat,
  lng,
  accuracy,
}) {
  const payload = {
    employee_code: employee_code.trim().toUpperCase(),
    device_id,
    token,
    location_id,
    lat,
    lng,
    accuracy,
  }

  try {
    // 1. محاولة استدعاء Supabase Edge Function
    const { data, error } = await supabase.functions.invoke('check-in', {
      body: payload,
    })

    if (!error && data) {
      return data
    }

    // إذا كان الخطأ متعلقاً بعدم نشر دالة Edge بعد (404 / FunctionsFetchError)، ننتقل للبديل
    console.warn('Edge Function returned error, trying RPC fallback:', error)
  } catch (err) {
    console.warn('Edge Function invoke failed, trying RPC fallback:', err)
  }

  // 2. البديل المباشر: استدعاء دالة check_in_rpc في قاعدة البيانات بصلاحيات SECURITY DEFINER
  const { data: rpcData, error: rpcError } = await supabase.rpc('check_in_rpc', {
    p_employee_code: payload.employee_code,
    p_device_id: payload.device_id,
    p_token: payload.token,
    p_location_id: payload.location_id,
    p_lat: payload.lat,
    p_lng: payload.lng,
    p_accuracy: payload.accuracy,
  })

  if (rpcError) {
    throw new Error(rpcError.message || 'فشل الاتصال بخادم تسجيل الحضور.')
  }

  return rpcData
}


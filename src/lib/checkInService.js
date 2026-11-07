import { supabase } from './supabase'

/**
 * دالة استدعاء تسجيل البصمة الموحدة (تدعم بصمة الباركود QR وبصمة الموقع GPS)
 */
export async function submitCheckIn({
  employee_code,
  device_id,
  token,
  location_id,
  lat,
  lng,
  accuracy,
  method = 'qr',
}) {
  const payload = {
    employee_code: employee_code.trim().toUpperCase(),
    device_id,
    token: token || null,
    location_id: location_id || null,
    lat: lat !== undefined ? lat : null,
    lng: lng !== undefined ? lng : null,
    accuracy: accuracy || null,
    method,
  }

  // 1. محاولة استدعاء Supabase Edge Function
  try {
    const { data, error } = await supabase.functions.invoke('check-in', {
      body: payload,
    })

    if (!error && data) {
      return data
    }
  } catch (err) {
    // الانتقال للـ RPC البديل
  }

  // 2. البديل المباشر: استدعاء دالة check_in_rpc في قاعدة البيانات
  const { data: rpcData, error: rpcError } = await supabase.rpc('check_in_rpc', {
    p_employee_code: payload.employee_code,
    p_device_id: payload.device_id,
    p_token: payload.token,
    p_location_id: payload.location_id,
    p_lat: payload.lat,
    p_lng: payload.lng,
    p_accuracy: payload.accuracy,
    p_method: payload.method,
  })

  if (rpcError) {
    // في حال كانت الدالة السابقة لا تزال بـ 7 معاملات (بدون p_method)
    if (rpcError.message?.includes('schema cache') || rpcError.code === 'PGRST202') {
      const fallbackOldRpc = await supabase.rpc('check_in_rpc', {
        p_employee_code: payload.employee_code,
        p_device_id: payload.device_id,
        p_token: payload.token || 'gps_pass',
        p_location_id: payload.location_id,
        p_lat: payload.lat || 0,
        p_lng: payload.lng || 0,
        p_accuracy: payload.accuracy || 10,
      })
      if (!fallbackOldRpc.error && fallbackOldRpc.data) {
        return fallbackOldRpc.data
      }
    }
    throw new Error(rpcError.message || 'فشل الاتصال بخادم تسجيل الحضور.')
  }

  return rpcData
}

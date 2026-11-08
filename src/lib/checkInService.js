import { supabase } from './supabase'

/**
 * دالة استدعاء تسجيل البصمة الموحدة (تدعم بصمة الباركود QR وبصمة الموقع GPS)
 * مع توافقية تلقائية وتراجع ذكي بين إصدارات الـ RPC (9 معاملات، 8 معاملات، 7 معاملات)
 */
export async function submitCheckIn({
  employee_code,
  device_id,
  device_info,
  token,
  location_id,
  lat,
  lng,
  accuracy,
  method = 'qr',
}) {
  const payload = {
    employee_code: String(employee_code || '').trim().toUpperCase(),
    device_id,
    device_info: device_info || null,
    token: token || null,
    location_id: location_id || null,
    lat: lat !== undefined ? lat : null,
    lng: lng !== undefined ? lng : null,
    accuracy: accuracy || null,
    method,
  }

  // 1. محاولة استدعاء Supabase Edge Function إن كانت منشورة
  try {
    const { data: edgeData, error: edgeError } = await supabase.functions.invoke('check-in', {
      body: payload,
    })

    if (!edgeError && edgeData) {
      return edgeData
    }
  } catch (err) {
    // الانتقال للـ RPC البديل مباشرة
  }

  // محاولة تحديث معلومات المتصفح والجهاز في جدول الموظفين بالخلفية
  if (payload.device_info && payload.employee_code) {
    supabase
      .from('employees')
      .update({ device_info: payload.device_info })
      .eq('employee_code', payload.employee_code)
      .then(() => {})
      .catch(() => {})
  }

  // 2. المحاولة الأولى: استدعاء RPC بكامل المعاملات (9 معاملات تشمل device_info)
  let rpcRes = await supabase.rpc('check_in_rpc', {
    p_employee_code: payload.employee_code,
    p_device_id: payload.device_id,
    p_token: payload.token,
    p_location_id: payload.location_id,
    p_lat: payload.lat,
    p_lng: payload.lng,
    p_accuracy: payload.accuracy,
    p_method: payload.method,
    p_device_info: payload.device_info,
  })

  // 3. المحاولة الثانية: في حال لم تكن نسخة الـ 9 معاملات منشورة بقاعدة البيانات، نطلب نسخة الـ 8 معاملات
  if (
    rpcRes.error &&
    (rpcRes.error.message?.includes('schema cache') ||
      rpcRes.error.code === 'PGRST202' ||
      rpcRes.error.message?.includes('Could not find') ||
      rpcRes.error.message?.includes('candidate'))
  ) {
    rpcRes = await supabase.rpc('check_in_rpc', {
      p_employee_code: payload.employee_code,
      p_device_id: payload.device_id,
      p_token: payload.token,
      p_location_id: payload.location_id,
      p_lat: payload.lat,
      p_lng: payload.lng,
      p_accuracy: payload.accuracy,
      p_method: payload.method,
    })
  }

  // 4. المحاولة الثالثة: نسخة الـ 7 معاملات القديمة كخيار احتياطي أخير
  if (
    rpcRes.error &&
    (rpcRes.error.message?.includes('schema cache') ||
      rpcRes.error.code === 'PGRST202' ||
      rpcRes.error.message?.includes('Could not find') ||
      rpcRes.error.message?.includes('candidate'))
  ) {
    rpcRes = await supabase.rpc('check_in_rpc', {
      p_employee_code: payload.employee_code,
      p_device_id: payload.device_id,
      p_token: payload.token || 'qr_pass',
      p_location_id: payload.location_id,
      p_lat: payload.lat || 0,
      p_lng: payload.lng || 0,
      p_accuracy: payload.accuracy || 10,
    })
  }

  // إذا استمر الخطأ
  if (rpcRes.error) {
    console.error('Check-in RPC error:', rpcRes.error)
    throw new Error(
      rpcRes.error.message || 'تعذر تسجيل البصمة. يرجى التأكد من تشغيل التحديثات في قاعدة البيانات.'
    )
  }

  return rpcRes.data
}

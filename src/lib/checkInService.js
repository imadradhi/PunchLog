import { supabase } from './supabase'

/**
 * دالة استدعاء تسجيل البصمة الموحدة (تدعم بصمة الباركود QR وبصمة الموقع GPS)
 * مع تدقيق استباقي لمنع مشاركة الأجهزة، وتراجع ذكي بين توقيعات الـ RPC
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
  const normalizedCode = String(employee_code || '').trim().toUpperCase()

  const payload = {
    employee_code: normalizedCode,
    device_id,
    device_info: device_info || null,
    token: token || null,
    location_id: location_id || null,
    lat: lat !== undefined ? lat : null,
    lng: lng !== undefined ? lng : null,
    accuracy: accuracy || null,
    method,
  }

  // 1. تدقيق أمني استباقي: هل هذا الجهاز مربوط مسبقاً بموظف آخر في النظام؟
  try {
    const { data: conflictEmp } = await supabase
      .from('employees')
      .select('id, name, employee_code')
      .eq('device_id', payload.device_id)
      .neq('employee_code', payload.employee_code)
      .maybeSingle()

    if (conflictEmp) {
      // توثيق المحاولة المرفوضة في سجل الأجهزة
      try {
        await supabase.from('device_binding_logs').insert({
          employee_name: payload.employee_code,
          employee_code: payload.employee_code,
          device_id: payload.device_id,
          device_info: payload.device_info,
          action: 'rejected_conflict',
          status: 'rejected',
          reason: `محاولة استخدام هاتف مسجل مسبقاً للموظف (${conflictEmp.name} #${conflictEmp.employee_code})`,
        })
      } catch (_) {
        // تجاهل أي خطأ في جدول السجل إذا لم ينشأ بعد
      }

      return {
        success: false,
        is_device_conflict: true,
        conflicting_employee: conflictEmp,
        error: `هذا الجهاز مرتبط مسبقاً بحساب موظف آخر (${conflictEmp.name} #${conflictEmp.employee_code}). لا يمكن استخدام نفس الهاتف لأكثر من موظف نهائياً. يرجى مراجعة إدارة النظام لفك ربط الجهاز.`,
      }
    }
  } catch (conflictCheckErr) {
    console.warn('Pre-check conflict query error:', conflictCheckErr)
  }

  // 2. محاولة استدعاء Supabase Edge Function إن كانت منشورة
  try {
    const { data: edgeData, error: edgeError } = await supabase.functions.invoke('check-in', {
      body: payload,
    })

    if (!edgeError && edgeData) {
      return edgeData
    }
  } catch (err) {
    // الانتقال للـ RPC البديل
  }

  // محاولة تحديث معلومات المتصفح والجهاز في جدول الموظفين
  if (payload.device_info && payload.employee_code) {
    supabase
      .from('employees')
      .update({ device_info: payload.device_info })
      .eq('employee_code', payload.employee_code)
      .then(() => {})
      .catch(() => {})
  }

  // 3. المحاولة الأولى: استدعاء RPC بـ 9 معاملات (تشمل device_info)
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

  // 4. المحاولة الثانية: استدعاء RPC بـ 8 معاملات
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

  // 5. المحاولة الثالثة: استدعاء RPC بـ 7 معاملات
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

  // 6. اعتراض خطأ قيد الفرادة (Unique Constraint Violation) وتحويله لرسالة عربية واضحة
  const isUniqueViolation =
    rpcRes.error &&
    (rpcRes.error.message?.includes('unique constraint') ||
      rpcRes.error.message?.includes('duplicate key') ||
      rpcRes.error.message?.includes('employees_device_id_unique_idx') ||
      rpcRes.error.code === '23505')

  if (isUniqueViolation) {
    let conflictText = ''
    try {
      const { data: cEmp } = await supabase
        .from('employees')
        .select('name, employee_code')
        .eq('device_id', payload.device_id)
        .neq('employee_code', payload.employee_code)
        .maybeSingle()

      if (cEmp) {
        conflictText = ` (${cEmp.name} #${cEmp.employee_code})`
      }
    } catch (_) {}

    return {
      success: false,
      is_device_conflict: true,
      error: `هذا الجهاز مرتبط مسبقاً بحساب موظف آخر${conflictText}. نظام PunchLog يمنع مشاركة نفس الهاتف بين أكثر من موظف لضمان النزاهة. يرجى مراجعة الإدارة لفك ربط الهاتف السابق.`,
    }
  }

  // إذا استمر خطأ آخر
  if (rpcRes.error) {
    console.error('Check-in RPC error:', rpcRes.error)
    throw new Error(rpcRes.error.message || 'تعذر معالجة البصمة في الخادم.')
  }

  return rpcRes.data
}

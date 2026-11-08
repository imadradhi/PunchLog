import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { 
  Smartphone, Check, X, Unlink, RefreshCw, 
  AlertCircle, CheckCircle2, Loader2, Clock, ShieldCheck, 
  ShieldAlert, AlertTriangle, Trash2
} from 'lucide-react'
import { formatArabicDateTime } from '../../lib/utils'

export default function DeviceRequests() {
  const [employees, setEmployees] = useState([])
  const [rejectedLogs, setRejectedLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [activeSubTab, setActiveSubTab] = useState('pending') // 'pending' | 'approved' | 'rejected'

  const fetchDeviceData = async () => {
    try {
      setLoading(true)
      
      // 1. جلب بيانات الموظفين بحالة معلقة أو معتمدة
      const { data: emps, error: empError } = await supabase
        .from('employees')
        .select('*')
        .in('device_status', ['pending', 'approved'])
        .order('device_registered_at', { ascending: false, nullsFirst: false })

      if (empError) throw empError
      setEmployees(emps || [])

      // 2. جلب سجل محاولات الربط المرفوضة
      try {
        const { data: logs, error: logsError } = await supabase
          .from('device_binding_logs')
          .select('*')
          .eq('status', 'rejected')
          .order('created_at', { ascending: false })
          .limit(100)

        if (!logsError && logs) {
          setRejectedLogs(logs)
        } else {
          setRejectedLogs([])
        }
      } catch (logErr) {
        console.warn('device_binding_logs table might not exist yet:', logErr)
        setRejectedLogs([])
      }
    } catch (err) {
      console.error('Error fetching device data:', err)
      setErrorMsg('تعذر جلب بيانات الأجهزة: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDeviceData()
  }, [])

  // الموافقة على ربط الجهاز
  const handleApprove = async (emp) => {
    try {
      setProcessingId(emp.id)
      setErrorMsg('')
      setSuccessMsg('')

      const serverNow = new Date().toISOString()

      const { error } = await supabase
        .from('employees')
        .update({
          device_status: 'approved',
          device_registered_at: serverNow,
        })
        .eq('id', emp.id)

      if (error) throw error

      // توثيق الاعتماد في سجل الأجهزة
      try {
        await supabase.from('device_binding_logs').insert({
          employee_id: emp.id,
          employee_name: emp.name,
          employee_code: emp.employee_code,
          device_id: emp.device_id,
          device_info: emp.device_info || null,
          action: 'approved',
          status: 'approved',
          reason: 'تم اعتماد الجهاز رسمياً من قبل مدير النظام',
        })
      } catch (e) {
        console.warn('Logging approved attempt skipped:', e)
      }

      setSuccessMsg(`تمت الموافقة على ربط جهاز الموظف (${emp.name}) بنجاح.`)
      fetchDeviceData()
    } catch (err) {
      setErrorMsg('فشل اعتماد الجهاز: ' + err.message)
    } finally {
      setProcessingId(null)
    }
  }

  // رفض طلب ربط الجهاز
  const handleReject = async (emp) => {
    if (!window.confirm(`هل أنت متأكد من رفض طلب ربط الجهاز للموظف "${emp.name}"؟`)) {
      return
    }

    try {
      setProcessingId(emp.id)
      setErrorMsg('')
      setSuccessMsg('')

      // توثيق الرفض في سجل الأجهزة
      try {
        await supabase.from('device_binding_logs').insert({
          employee_id: emp.id,
          employee_name: emp.name,
          employee_code: emp.employee_code,
          device_id: emp.device_id,
          device_info: emp.device_info || null,
          action: 'rejected_manual',
          status: 'rejected',
          reason: 'رفض طلب ربط الجهاز يدوياً بواسطة المدير',
        })
      } catch (e) {
        console.warn('Logging rejected attempt skipped:', e)
      }

      const { error } = await supabase
        .from('employees')
        .update({
          device_id: null,
          device_info: null,
          device_status: 'none',
          device_registered_at: null,
        })
        .eq('id', emp.id)

      if (error) throw error

      setSuccessMsg(`تم رفض طلب ربط الجهاز للموظف (${emp.name}) وتوثيق ذلك في سجل المرفوضات.`)
      fetchDeviceData()
    } catch (err) {
      setErrorMsg('فشل رفض الطلب: ' + err.message)
    } finally {
      setProcessingId(null)
    }
  }

  // فك ربط جهاز مفعّل
  const handleUnlink = async (emp) => {
    if (
      !window.confirm(
        `تنبيه: سيتم فك ربط جهاز الموظف "${emp.name}". لن يتمكن من تسجيل البصمة حتى يطلب ربط جهاز جديد وتوافق عليه. هل تريد الاستمرار؟`
      )
    ) {
      return
    }

    try {
      setProcessingId(emp.id)
      setErrorMsg('')
      setSuccessMsg('')

      // توثيق فك الارتباط
      try {
        await supabase.from('device_binding_logs').insert({
          employee_id: emp.id,
          employee_name: emp.name,
          employee_code: emp.employee_code,
          device_id: emp.device_id,
          device_info: emp.device_info || null,
          action: 'unlinked',
          status: 'rejected',
          reason: 'فك ارتباط الجهاز بواسطة المدير',
        })
      } catch (e) {
        console.warn('Logging unlinked attempt skipped:', e)
      }

      const { error } = await supabase
        .from('employees')
        .update({
          device_id: null,
          device_info: null,
          device_status: 'none',
          device_registered_at: null,
        })
        .eq('id', emp.id)

      if (error) throw error

      setSuccessMsg(`تم فك ربط الجهاز للموظف (${emp.name}) بنجاح.`)
      fetchDeviceData()
    } catch (err) {
      setErrorMsg('فشل فك ربط الجهاز: ' + err.message)
    } finally {
      setProcessingId(null)
    }
  }

  // مسح سجل محاولة مرفوضة فردية
  const handleDeleteLog = async (logId) => {
    try {
      const { error } = await supabase
        .from('device_binding_logs')
        .delete()
        .eq('id', logId)

      if (error) throw error
      setRejectedLogs(prev => prev.filter(l => l.id !== logId))
    } catch (err) {
      setErrorMsg('تعذر حذف السجل: ' + err.message)
    }
  }

  // مسح كافة سجلات المرفوضات
  const handleClearAllRejected = async () => {
    if (!window.confirm('هل أنت متأكد من مسح جميع سجلات المحاولات المرفوضة؟')) return
    try {
      const { error } = await supabase
        .from('device_binding_logs')
        .delete()
        .eq('status', 'rejected')

      if (error) throw error
      setRejectedLogs([])
      setSuccessMsg('تم مسح سجل المحاولات المرفوضة بنجاح.')
    } catch (err) {
      setErrorMsg('تعذر مسح السجلات: ' + err.message)
    }
  }

  const pendingRequests = employees.filter((e) => e.device_status === 'pending')
  const approvedDevices = employees.filter((e) => e.device_status === 'approved')

  return (
    <div className="space-y-6">
      {/* الشريط العلوي */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-amber-500" />
            إدارة وتدقيق ربط الأجهزة (Device Binding Audit)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            قيد فريد صارم (1 جهاز = 1 موظف)، كشف المتصفح ونوع الجهاز، وتوثيق المحاولات المرفوضة
          </p>
        </div>

        <button
          onClick={fetchDeviceData}
          disabled={loading}
          className="inline-flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
          title="تحديث البيانات"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="text-xs font-semibold">تحديث</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* التبديل بين التبويبات الفرعية */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveSubTab('pending')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSubTab === 'pending'
              ? 'bg-amber-500 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>طلبات بانتظار الموافقة ({pendingRequests.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('approved')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSubTab === 'approved'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>الأجهزة المعتمدة والمربوطة ({approvedDevices.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('rejected')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSubTab === 'rejected'
              ? 'bg-rose-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>سجل المحاولات المرفوضة ({rejectedLogs.length})</span>
          {rejectedLogs.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-rose-300 animate-ping" />
          )}
        </button>
      </div>

      {/* محتوى قسم الطلبات المعلقة */}
      {activeSubTab === 'pending' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500 mb-2" />
              <p className="text-sm">جاري جلب الطلبات المعلقة...</p>
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
              <p className="font-semibold text-slate-700">لا توجد طلبات معلقة حالياً</p>
              <p className="text-xs text-slate-400 mt-1">
                عندما يحاول موظف جديد الدخول من هاتفه لأول مرة، سيظهر طلبه هنا لاعتماده.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-semibold">
                  <tr>
                    <th className="py-3.5 px-4">اسم الموظف</th>
                    <th className="py-3.5 px-4">الرقم الوظيفي</th>
                    <th className="py-3.5 px-4">نوع الجهاز / المتصفح</th>
                    <th className="py-3.5 px-4">معرّف الجهاز (Device UUID)</th>
                    <th className="py-3.5 px-4">تاريخ الطلب</th>
                    <th className="py-3.5 px-4 text-center">الإجراء المطلوب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingRequests.map((emp) => (
                    <tr key={emp.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">{emp.name}</td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-xs">
                          {emp.employee_code}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs font-medium text-slate-700">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700">
                          <Smartphone className="w-3.5 h-3.5 text-slate-500" />
                          {emp.device_info || 'هاتف ذكي (غير محدد)'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-xs text-slate-600 bg-slate-50 p-1.5 rounded border border-slate-200 select-all block max-w-[190px] truncate" title={emp.device_id}>
                          {emp.device_id || 'غير متوفر'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500">
                        {formatArabicDateTime(emp.device_registered_at || emp.updated_at)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => handleApprove(emp)}
                            disabled={processingId === emp.id}
                            className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                          >
                            {processingId === emp.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            <span>موافقة</span>
                          </button>
                          <button
                            onClick={() => handleReject(emp)}
                            disabled={processingId === emp.id}
                            className="inline-flex items-center gap-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>رفض</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* محتوى قسم الأجهزة المعتمدة والمربوطة */}
      {activeSubTab === 'approved' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mb-2" />
              <p className="text-sm">جاري جلب الأجهزة المعتمدة...</p>
            </div>
          ) : approvedDevices.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Smartphone className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="font-semibold text-slate-700">لا توجد أجهزة مفعلة حالياً</p>
              <p className="text-xs text-slate-400 mt-1">
                ستظهر هنا أجهزة الموظفين التي تم قبولها وتفعيل بصمتها.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-semibold">
                  <tr>
                    <th className="py-3.5 px-4">اسم الموظف</th>
                    <th className="py-3.5 px-4">الرقم الوظيفي</th>
                    <th className="py-3.5 px-4">نوع الجهاز / المتصفح</th>
                    <th className="py-3.5 px-4">معرّف الجهاز (Device UUID)</th>
                    <th className="py-3.5 px-4">تاريخ التفعيل والربط</th>
                    <th className="py-3.5 px-4 text-center">فك الارتباط</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {approvedDevices.map((emp) => (
                    <tr key={emp.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">{emp.name}</td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-xs">
                          {emp.employee_code}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs font-medium text-slate-700">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800">
                          <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                          {emp.device_info || 'هاتف ذكي (معتمد)'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-xs text-slate-600 bg-slate-50 p-1.5 rounded border border-slate-200 select-all block max-w-[190px] truncate" title={emp.device_id}>
                          {emp.device_id}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500">
                        {formatArabicDateTime(emp.device_registered_at)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => handleUnlink(emp)}
                          disabled={processingId === emp.id}
                          className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                          title="فك ربط الجهاز للسماح للموظف بتسجيل جهاز جديد"
                        >
                          {processingId === emp.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Unlink className="w-3.5 h-3.5" />
                          )}
                          <span>فك ربط الجهاز</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* محتوى قسم المحاولات المرفوضة */}
      {activeSubTab === 'rejected' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 bg-rose-50/50 border-b border-rose-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div className="flex items-center gap-2 text-rose-800 text-xs font-bold">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              <span>سجل الحماية: محاولات الربط أو البصمة التي رُفضت بسبب اختلاف أو تضارب الأجهزة</span>
            </div>
            {rejectedLogs.length > 0 && (
              <button
                onClick={handleClearAllRejected}
                className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-800 hover:underline cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>مسح كل السجلات المرفوضة</span>
              </button>
            )}
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-rose-600 mb-2" />
              <p className="text-sm">جاري جلب سجلات الحماية...</p>
            </div>
          ) : rejectedLogs.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="font-semibold text-slate-700">السجل نظيف - لا توجد أي محاولات مرفوضة</p>
              <p className="text-xs text-slate-400 mt-1">
                يتم تسجيل أي محاولة لاستخدام هاتف موظف آخر أو جهاز غير معتمد هنا فورياً.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-semibold">
                  <tr>
                    <th className="py-3.5 px-4">الموظف المعني</th>
                    <th className="py-3.5 px-4">نوع الجهاز / المتصفح</th>
                    <th className="py-3.5 px-4">معرّف الجهاز (UUID)</th>
                    <th className="py-3.5 px-4">سبب الرفض والتدقيق</th>
                    <th className="py-3.5 px-4">تاريخ وتوقيت المحاولة</th>
                    <th className="py-3.5 px-4 text-center">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rejectedLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-rose-50/30 transition">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        <div>{log.employee_name || 'غير معروف'}</div>
                        {log.employee_code && (
                          <span className="font-mono text-xs text-slate-500">
                            #{log.employee_code}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700">
                          <Smartphone className="w-3.5 h-3.5 text-slate-500" />
                          {log.device_info || 'غير محدد'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-xs text-rose-700 bg-rose-50 p-1.5 rounded border border-rose-200 select-all block max-w-[180px] truncate" title={log.device_id}>
                          {log.device_id}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-1.5 text-rose-800 text-xs font-medium max-w-sm">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                          <span>{log.reason}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500 whitespace-nowrap">
                        {formatArabicDateTime(log.created_at)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => handleDeleteLog(log.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                          title="حذف هذا السجل"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

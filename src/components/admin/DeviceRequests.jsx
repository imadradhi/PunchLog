import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { 
  Smartphone, Check, X, Unlink, RefreshCw, 
  AlertCircle, CheckCircle2, Loader2, Clock, ShieldCheck 
} from 'lucide-react'
import { formatArabicDateTime } from '../../lib/utils'

export default function DeviceRequests() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [activeSubTab, setActiveSubTab] = useState('pending') // 'pending' | 'approved'

  const fetchDeviceData = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .in('device_status', ['pending', 'approved'])
        .order('device_registered_at', { ascending: false, nullsFirst: false })

      if (error) throw error
      setEmployees(data || [])
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

      const { error } = await supabase
        .from('employees')
        .update({
          device_status: 'approved',
          device_registered_at: new Date().toISOString(),
        })
        .eq('id', emp.id)

      if (error) throw error

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

      const { error } = await supabase
        .from('employees')
        .update({
          device_id: null,
          device_status: 'none',
          device_registered_at: null,
        })
        .eq('id', emp.id)

      if (error) throw error

      setSuccessMsg(`تم رفض طلب ربط الجهاز للموظف (${emp.name}).`)
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

      const { error } = await supabase
        .from('employees')
        .update({
          device_id: null,
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

  const pendingRequests = employees.filter((e) => e.device_status === 'pending')
  const approvedDevices = employees.filter((e) => e.device_status === 'approved')

  return (
    <div className="space-y-6">
      {/* الشريط العلوي */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-amber-500" />
            طلبات وإدارة ربط أجهزة الموظفين (Device Binding)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            التحكم في الأجهزة المعتمدة ومنع التلاعب عبر تسجيل الحضور من أجهزة خارجية
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

      {/* التبديل بين الطلبات المعلقة والأجهزة المعتمدة */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveSubTab('pending')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
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
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSubTab === 'approved'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>الأجهزة المعتمدة والمربوطة ({approvedDevices.length})</span>
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
                    <th className="py-3.5 px-4">القسم</th>
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
                      <td className="py-3.5 px-4 text-slate-600">{emp.department}</td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-xs text-slate-600 bg-slate-50 p-1 rounded border border-slate-200 select-all block max-w-[200px] truncate" title={emp.device_id}>
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
                    <th className="py-3.5 px-4">القسم</th>
                    <th className="py-3.5 px-4">معرّف الجهاز (Device UUID)</th>
                    <th className="py-3.5 px-4">تاريخ التفعيل</th>
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
                      <td className="py-3.5 px-4 text-slate-600">{emp.department}</td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-xs text-slate-600 bg-slate-50 p-1 rounded border border-slate-200 select-all block max-w-[200px] truncate" title={emp.device_id}>
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
    </div>
  )
}


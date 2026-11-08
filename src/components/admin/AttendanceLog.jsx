import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { 
  History, Calendar, Filter, User, ArrowDownRight, 
  ArrowUpLeft, RefreshCw, AlertCircle, Loader2, MapPin,
  QrCode, Navigation, PlusCircle, Edit3, Trash2, X, CheckCircle2
} from 'lucide-react'
import { formatArabicDateTime } from '../../lib/utils'

export default function AttendanceLog() {
  const [logs, setLogs] = useState([])
  const [employees, setEmployees] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // خيارات الفلترة
  const [selectedDate, setSelectedDate] = useState('') // YYYY-MM-DD
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [selectedType, setSelectedType] = useState('') // 'in' | 'out' | ''

  // نافذة تسجيل البصمة اليدوية بواسطة المدير
  const [isManualModalOpen, setIsManualModalOpen] = useState(false)
  const [manualSubmitting, setManualSubmitting] = useState(false)
  const [manualForm, setManualForm] = useState({
    employee_id: '',
    type: 'in',
    location_id: '',
    datetime: new Date().toISOString().slice(0, 16),
    notes: '',
  })

  // جلب قائمة الموظفين والمواقع للفلترة والتسجيل اليدوي
  useEffect(() => {
    async function loadMetadata() {
      try {
        const { data: emps } = await supabase
          .from('employees')
          .select('id, name, employee_code')
          .order('name', { ascending: true })
        if (emps) setEmployees(emps)

        const { data: locs } = await supabase
          .from('locations')
          .select('id, name')
          .order('name', { ascending: true })
        if (locs) {
          setLocations(locs)
          if (locs.length > 0) {
            setManualForm((prev) => ({ ...prev, location_id: locs[0].id }))
          }
        }
      } catch (err) {
        console.error('Error loading metadata:', err)
      }
    }
    loadMetadata()
  }, [])

  // جلب سجلات الحضور والانصراف
  const fetchAttendanceLogs = async () => {
    try {
      setLoading(true)
      setErrorMsg('')

      let query = supabase
        .from('attendance')
        .select(`
          id,
          type,
          method,
          notes,
          lat,
          lng,
          accuracy,
          created_at,
          employees (
            id,
            name,
            employee_code,
            department
          ),
          locations (
            id,
            name
          )
        `)
        .order('created_at', { ascending: false })

      // تطبيق فلتر الموظف
      if (selectedEmployeeId) {
        query = query.eq('employee_id', selectedEmployeeId)
      }

      // تطبيق فلتر نوع الحركة
      if (selectedType) {
        query = query.eq('type', selectedType)
      }

      // تطبيق فلتر التاريخ
      if (selectedDate) {
        const startOfDay = new Date(`${selectedDate}T00:00:00.000Z`).toISOString()
        const endOfDay = new Date(`${selectedDate}T23:59:59.999Z`).toISOString()
        query = query.gte('created_at', startOfDay).lte('created_at', endOfDay)
      }

      let { data, error } = await query

      // بديل ذكي في حال لم يكن عمود notes قد أضيف بعد في قاعدة البيانات
      if (error && (error.message?.includes('notes') || error.code === '42703')) {
        let fallbackQuery = supabase
          .from('attendance')
          .select(`
            id,
            type,
            method,
            lat,
            lng,
            accuracy,
            created_at,
            employees (
              id,
              name,
              employee_code,
              department
            ),
            locations (
              id,
              name
            )
          `)
          .order('created_at', { ascending: false })

        if (selectedEmployeeId) fallbackQuery = fallbackQuery.eq('employee_id', selectedEmployeeId)
        if (selectedType) fallbackQuery = fallbackQuery.eq('type', selectedType)
        if (selectedDate) {
          const startOfDay = new Date(`${selectedDate}T00:00:00.000Z`).toISOString()
          const endOfDay = new Date(`${selectedDate}T23:59:59.999Z`).toISOString()
          fallbackQuery = fallbackQuery.gte('created_at', startOfDay).lte('created_at', endOfDay)
        }

        const fallbackRes = await fallbackQuery
        data = fallbackRes.data
        error = fallbackRes.error
      }

      if (error) throw error
      setLogs(data || [])
    } catch (err) {
      console.error('Error fetching attendance logs:', err)
      setErrorMsg('تعذر جلب سجلات الحضور: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAttendanceLogs()
  }, [selectedDate, selectedEmployeeId, selectedType])

  // تسجيل بصمة يدوية بواسطة المدير
  const handleManualPunchSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    if (!manualForm.employee_id) {
      alert('يرجى اختيار الموظف.')
      return
    }

    const selectedEmp = employees.find((e) => e.id === manualForm.employee_id)
    const empName = selectedEmp ? selectedEmp.name : 'الموظف'
    const actionName = manualForm.type === 'in' ? 'حضور (دخول)' : 'انصراف (خروج)'

    if (!window.confirm(`هل أنت متأكد من تسجيل حركة "${actionName}" يدوياً للموظف "${empName}"؟`)) {
      return
    }

    try {
      setManualSubmitting(true)
      const punchDate = new Date(manualForm.datetime)

      let { error } = await supabase.from('attendance').insert([
        {
          employee_id: manualForm.employee_id,
          location_id: manualForm.location_id || null,
          type: manualForm.type,
          method: 'manual',
          notes: manualForm.notes.trim() || 'تسجيل يدوي بواسطة المدير',
          accuracy: 0,
          created_at: punchDate.toISOString(),
        },
      ])

      // في حال لم يكن عمود notes مضافاً بعد
      if (error && (error.message?.includes('notes') || error.code === '42703')) {
        const retryRes = await supabase.from('attendance').insert([
          {
            employee_id: manualForm.employee_id,
            location_id: manualForm.location_id || null,
            type: manualForm.type,
            method: 'manual',
            accuracy: 0,
            created_at: punchDate.toISOString(),
          },
        ])
        error = retryRes.error
      }

      if (error) throw error

      setSuccessMsg(`تم تسجيل حركة (${actionName}) يدوياً للموظف (${empName}) بنجاح.`)
      setIsManualModalOpen(false)
      setManualForm({
        employee_id: '',
        type: 'in',
        location_id: locations[0]?.id || '',
        datetime: new Date().toISOString().slice(0, 16),
        notes: '',
      })
      fetchAttendanceLogs()
    } catch (err) {
      console.error('Manual punch error:', err)
      setErrorMsg('فشل تسجيل البصمة اليدوية: ' + err.message)
    } finally {
      setManualSubmitting(false)
    }
  }

  // حذف حركة حضور معينة
  const handleDeleteAttendance = async (log) => {
    const empName = log.employees?.name || 'الموظف'
    const typeArabic = log.type === 'in' ? 'حضور' : 'انصراف'

    if (
      !window.confirm(
        `هل أنت متأكد من حذف حركة (${typeArabic}) للموظف "${empName}" المسجلة بتاريخ ${formatArabicDateTime(log.created_at)}؟\n\nتنبيه: سيتم مسح هذا السجل نهائياً.`
      )
    ) {
      return
    }

    try {
      setLoading(true)
      const { error } = await supabase.from('attendance').delete().eq('id', log.id)
      if (error) throw error

      setSuccessMsg(`تم حذف حركة (${typeArabic}) للموظف (${empName}) بنجاح.`)
      fetchAttendanceLogs()
    } catch (err) {
      alert('فشل حذف السجل: ' + err.message)
      setLoading(false)
    }
  }

  // تعيين فلتر "اليوم" بسرعة
  const setTodayFilter = () => {
    const today = new Date().toISOString().split('T')[0]
    setSelectedDate(today)
  }

  // مسح جميع الفلاتر
  const clearFilters = () => {
    setSelectedDate('')
    setSelectedEmployeeId('')
    setSelectedType('')
  }

  const totalIn = logs.filter((l) => l.type === 'in').length
  const totalOut = logs.filter((l) => l.type === 'out').length
  const totalManual = logs.filter((l) => l.method === 'manual').length

  return (
    <div className="space-y-6">
      {/* الشريط العلوي */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <History className="w-5 h-5 text-blue-600" />
            سجل حركات الحضور والانصراف
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            متابعة دقيقة ولحظية لكافة عمليات البصمة المعتمدة (الباركود، الموقع GPS، والتسجيل اليدوي)
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {/* زر تسجيل بصمة يدوية بواسطة المدير */}
          <button
            onClick={() => {
              setManualForm((prev) => ({
                ...prev,
                datetime: new Date().toISOString().slice(0, 16),
              }))
              setIsManualModalOpen(true)
            }}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>تسجيل بصمة يدوية</span>
          </button>

          <button
            onClick={fetchAttendanceLogs}
            disabled={loading}
            className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
            title="تحديث السجلات"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* رسائل التنبيه والنجاح */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 animate-in fade-in">
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

      {/* بطاقات الإحصاءات السريعة */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500">إجمالي الحركات المعروضة</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{logs.length}</p>
          </div>
          <div className="p-3 bg-slate-100 text-slate-600 rounded-xl">
            <History className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-emerald-600">عمليات الحضور (IN)</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{totalIn}</p>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <ArrowDownRight className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-blue-600">عمليات الانصراف (OUT)</p>
            <p className="text-2xl font-bold text-blue-700 mt-1">{totalOut}</p>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <ArrowUpLeft className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-amber-600">البصمات اليدوية</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">{totalManual}</p>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Edit3 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* شريط الفلاتر والبحث */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <Filter className="w-4 h-4 text-blue-600" />
          <span>تصفية:</span>
        </div>

        {/* فلتر التاريخ */}
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
          <Calendar className="w-3.5 h-3.5 text-slate-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent text-xs text-slate-700 focus:outline-none cursor-pointer"
          />
        </div>

        <button
          onClick={setTodayFilter}
          className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition cursor-pointer"
        >
          اليوم فقط
        </button>

        {/* فلتر الموظف */}
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
          <User className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
            className="bg-transparent text-xs text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="">جميع الموظفين</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.employee_code})
              </option>
            ))}
          </select>
        </div>

        {/* فلتر نوع الحركة */}
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="bg-transparent text-xs text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="">جميع الحركات</option>
            <option value="in">حضور فقط</option>
            <option value="out">انصراف فقط</option>
          </select>
        </div>

        {(selectedDate || selectedEmployeeId || selectedType) && (
          <button
            onClick={clearFilters}
            className="text-xs text-slate-400 hover:text-slate-600 underline cursor-pointer mr-auto"
          >
            مسح الفلاتر
          </button>
        )}
      </div>

      {/* جدول السجلات */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
            <p className="text-sm">جاري جلب سجلات الحضور والانصراف...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <History className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="font-semibold text-slate-700">لا توجد سجلات حضور مطابقة</p>
            <p className="text-xs text-slate-400 mt-1">
              عندما يسجل الموظفون بصماتهم أو يقوم المدير بتسجيل بصمة يدوية، ستظهر هنا فورياً.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-semibold">
                <tr>
                  <th className="py-3.5 px-4">نوع الحركة</th>
                  <th className="py-3.5 px-4">طريقة البصمة</th>
                  <th className="py-3.5 px-4">اسم الموظف</th>
                  <th className="py-3.5 px-4">الرقم الوظيفي</th>
                  <th className="py-3.5 px-4">القسم</th>
                  <th className="py-3.5 px-4">موقع العمل / الملاحظة</th>
                  <th className="py-3.5 px-4">التاريخ والوقت (ميلادي)</th>
                  <th className="py-3.5 px-4">دقة الموقع</th>
                  <th className="py-3.5 px-4 text-center">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => {
                  const isIn = log.type === 'in'
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                            isIn
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-blue-100 text-blue-800 border border-blue-200'
                          }`}
                        >
                          {isIn ? (
                            <>
                              <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" />
                              <span>حضور</span>
                            </>
                          ) : (
                            <>
                              <ArrowUpLeft className="w-3.5 h-3.5 text-blue-600" />
                              <span>انصراف</span>
                            </>
                          )}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        {log.method === 'manual' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            <Edit3 className="w-3 h-3 text-amber-600" />
                            <span>يدوي (إداري)</span>
                          </span>
                        ) : log.method === 'gps' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Navigation className="w-3 h-3 text-emerald-600" />
                            <span>الموقع GPS</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                            <QrCode className="w-3 h-3 text-purple-600" />
                            <span>باركود QR</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        {log.employees?.name || 'موظف محذوف'}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-xs font-bold">
                          {log.employees?.employee_code || '-'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {log.employees?.department || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">
                        <div>
                          <span className="inline-flex items-center gap-1 text-xs">
                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            <span>{log.locations?.name || 'موقع المقر'}</span>
                          </span>
                          {log.notes && (
                            <p className="text-[11px] text-amber-700 mt-0.5">
                              {log.notes}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-700 font-semibold">
                        {formatArabicDateTime(log.created_at)}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-mono text-slate-500">
                        {log.method === 'manual' ? '-' : `±${Math.round(log.accuracy || 0)} م`}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => handleDeleteAttendance(log)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                          title="حذف هذا السجل"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* نافذة تسجيل بصمة يدوية بواسطة المدير */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">
                  تسجيل بصمة يدوية بواسطة المدير
                </h3>
              </div>
              <button
                onClick={() => setIsManualModalOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleManualPunchSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  الموظف <span className="text-rose-500">*</span>
                </label>
                <select
                  value={manualForm.employee_id}
                  onChange={(e) => setManualForm({ ...manualForm, employee_id: e.target.value })}
                  required
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-blue-600 focus:bg-white text-slate-800"
                >
                  <option value="">-- اختر الموظف --</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} (#{emp.employee_code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  نوع الحركة <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setManualForm({ ...manualForm, type: 'in' })}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 ${
                      manualForm.type === 'in'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-2 ring-emerald-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}
                  >
                    <ArrowDownRight className="w-4 h-4 text-emerald-600" />
                    <span>حضور (دخول)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setManualForm({ ...manualForm, type: 'out' })}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 ${
                      manualForm.type === 'out'
                        ? 'bg-blue-50 text-blue-800 border-blue-300 ring-2 ring-blue-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}
                  >
                    <ArrowUpLeft className="w-4 h-4 text-blue-600" />
                    <span>انصراف (خروج)</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  التاريخ والوقت (ميلادي) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={manualForm.datetime}
                  onChange={(e) => setManualForm({ ...manualForm, datetime: e.target.value })}
                  required
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-blue-600 focus:bg-white text-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  موقع العمل
                </label>
                <select
                  value={manualForm.location_id}
                  onChange={(e) => setManualForm({ ...manualForm, location_id: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-blue-600 focus:bg-white text-slate-800"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  ملاحظة / سبب البصمة اليدوية (اختياري)
                </label>
                <input
                  type="text"
                  value={manualForm.notes}
                  onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
                  placeholder="مثال: نسي البصمة، عطل في الهاتف، إذن رسمي..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-blue-600 focus:bg-white text-slate-800"
                />
              </div>

              <div className="pt-3 flex gap-2.5 justify-end">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={manualSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-md shadow-blue-500/20"
                >
                  {manualSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>تسجيل البصمة</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

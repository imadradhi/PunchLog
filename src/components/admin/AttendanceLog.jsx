import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { 
  History, Calendar, Filter, User, ArrowDownRight, 
  ArrowUpLeft, RefreshCw, AlertCircle, Loader2, MapPin,
  QrCode, Navigation
} from 'lucide-react'
import { formatArabicDateTime } from '../../lib/utils'

export default function AttendanceLog() {
  const [logs, setLogs] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  // خيارات الفلترة
  const [selectedDate, setSelectedDate] = useState('') // YYYY-MM-DD
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [selectedType, setSelectedType] = useState('') // 'in' | 'out' | ''

  // جلب قائمة الموظفين للفلترة
  useEffect(() => {
    async function loadEmployees() {
      try {
        const { data } = await supabase
          .from('employees')
          .select('id, name, employee_code')
          .order('name', { ascending: true })
        if (data) setEmployees(data)
      } catch (err) {
        console.error('Error loading employees for filter:', err)
      }
    }
    loadEmployees()
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

      // تطبيق فلتر التاريخ (بداية ونهاية اليوم المحدد)
      if (selectedDate) {
        const startOfDay = new Date(`${selectedDate}T00:00:00.000Z`).toISOString()
        const endOfDay = new Date(`${selectedDate}T23:59:59.999Z`).toISOString()
        query = query.gte('created_at', startOfDay).lte('created_at', endOfDay)
      }

      const { data, error } = await query

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
            متابعة دقيقة ولحظية لكافة عمليات البصمة المعتمدة مع دقة الإحداثيات
          </p>
        </div>

        <button
          onClick={fetchAttendanceLogs}
          disabled={loading}
          className="inline-flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
          title="تحديث السجلات"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="text-xs font-semibold">تحديث</span>
        </button>
      </div>

      {/* بطاقات الإحصاءات السريعة */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

        {/* فلتر النوع */}
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 focus:outline-none cursor-pointer"
        >
          <option value="">جميع العمليات (حضور / انصراف)</option>
          <option value="in">حضور فقط</option>
          <option value="out">انصراف فقط</option>
        </select>

        {(selectedDate || selectedEmployeeId || selectedType) && (
          <button
            onClick={clearFilters}
            className="text-xs font-semibold text-rose-600 hover:underline px-2 py-1 transition cursor-pointer"
          >
            إلغاء الفلاتر
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

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
              عندما يسجل الموظفون بصماتهم بنجاح، ستظهر تفاصيل عملياتهم ومواقعهم هنا فورياً.
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
                  <th className="py-3.5 px-4">موقع العمل</th>
                  <th className="py-3.5 px-4">وقت وتاريخ الحركة</th>
                  <th className="py-3.5 px-4">دقة الموقع (GPS)</th>
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
                        {log.method === 'gps' ? (
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
                        <span className="font-mono bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-xs">
                          {log.employees?.employee_code || '-'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {log.employees?.department || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">
                        <span className="inline-flex items-center gap-1 text-xs">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          <span>{log.locations?.name || 'موقع عام'}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600">
                        {formatArabicDateTime(log.created_at)}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-mono text-slate-500">
                        ±{Math.round(log.accuracy || 0)} م
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}


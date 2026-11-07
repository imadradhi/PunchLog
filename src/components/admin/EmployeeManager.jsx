import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { 
  Users, UserPlus, Search, Edit2, CheckCircle2, 
  XCircle, Smartphone, AlertCircle, Loader2, RefreshCw 
} from 'lucide-react'

export default function EmployeeManager() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // حقول النموذج
  const [formData, setFormData] = useState({
    name: '',
    employee_code: '',
    department: '',
  })

  const fetchEmployees = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setEmployees(data || [])
    } catch (err) {
      console.error('Error fetching employees:', err)
      setErrorMsg('تعذر جلب بيانات الموظفين. تأكد من إعدادات Supabase وتطبيق الـ SQL.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEmployees()
  }, [])

  const [nextSuggestedCode, setNextSuggestedCode] = useState('1001')

  const openAddModal = () => {
    setEditingEmployee(null)
    setFormData({ name: '', employee_code: '', department: '' })
    setErrorMsg('')

    // حساب الرقم المقترح القادم
    const numericCodes = employees
      .map((e) => parseInt(e.employee_code, 10))
      .filter((n) => !isNaN(n) && n >= 1000 && n <= 9999)

    const next = numericCodes.length > 0 ? String(Math.max(...numericCodes) + 1) : '1001'
    setNextSuggestedCode(next)
    setIsModalOpen(true)
  }

  const openEditModal = (emp) => {
    setEditingEmployee(emp)
    setFormData({
      name: emp.name,
      employee_code: emp.employee_code,
      department: emp.department,
    })
    setErrorMsg('')
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingEmployee(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    if (!formData.name.trim() || !formData.department.trim()) {
      setErrorMsg('يرجى إدخال اسم الموظف والقسم.')
      return
    }

    try {
      setSubmitting(true)
      if (editingEmployee) {
        // تعديل بيانات الموظف (الاسم والقسم فقط للحفاظ على ثبات الرقم الوظيفي)
        const { error } = await supabase
          .from('employees')
          .update({
            name: formData.name.trim(),
            department: formData.department.trim(),
          })
          .eq('id', editingEmployee.id)

        if (error) throw error
        setSuccessMsg(`تم تحديث بيانات الموظف (${formData.name}) بنجاح.`)
      } else {
        // جلب أعلى رقم وظيفي مسجل حالياً في قاعدة البيانات وحساب الرقم التالي (4 أرقام)
        let nextCode = '1001'
        try {
          const { data: latestEmps } = await supabase
            .from('employees')
            .select('employee_code')

          if (latestEmps && latestEmps.length > 0) {
            const numericCodes = latestEmps
              .map((e) => parseInt(e.employee_code, 10))
              .filter((n) => !isNaN(n) && n >= 1000 && n <= 9999)

            if (numericCodes.length > 0) {
              nextCode = String(Math.max(...numericCodes) + 1)
            }
          }
        } catch {
          // استخدام 1001 كافتراضي في حال تعذر القراءة
        }

        // إضافة موظف جديد بالرقم المتولد تلقائياً (ضمان عدم وجود قيمة null)
        const { data, error } = await supabase
          .from('employees')
          .insert([
            {
              name: formData.name.trim(),
              employee_code: nextCode,
              department: formData.department.trim(),
              is_active: true,
              device_status: 'none',
            },
          ])
          .select()

        if (error) throw error
        const created = data?.[0]
        setSuccessMsg(
          `تمت إضافة الموظف (${created?.name}) بنجاح! الرقم التعريفي للبصمة هو: (${created?.employee_code}).`
        )
      }

      closeModal()
      fetchEmployees()
    } catch (err) {
      setErrorMsg(err.message || 'حدث خطأ أثناء حفظ البيانات.')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleEmployeeStatus = async (emp) => {
    try {
      const nextStatus = !emp.is_active
      const { error } = await supabase
        .from('employees')
        .update({ is_active: nextStatus })
        .eq('id', emp.id)

      if (error) throw error
      setEmployees((prev) =>
        prev.map((item) => (item.id === emp.id ? { ...item, is_active: nextStatus } : item))
      )
    } catch (err) {
      alert('تعذر تغيير حالة الموظف: ' + err.message)
    }
  }

  const filteredEmployees = employees.filter(
    (emp) =>
      emp.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.employee_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.department?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getDeviceBadge = (status) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" />
            مفعّل
          </span>
        )
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
            <Smartphone className="w-3 h-3" />
            بانتظار الموافقة
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
            غير مربوط
          </span>
        )
    }
  }

  return (
    <div className="space-y-6">
      {/* الشريط العلوي والأزرار */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            إدارة الموظفين ({employees.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            إضافة وتعديل بيانات الموظفين ومتابعة حالة أجهزتهم المسجلة
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchEmployees}
            disabled={loading}
            className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
            title="تحديث القائمة"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={openAddModal}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition shadow-sm cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            إضافة موظف
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* شريط البحث */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="بحث بالاسم، الرقم الوظيفي، أو القسم..."
          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 pl-10 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition shadow-sm"
        />
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
      </div>

      {/* جدول الموظفين */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
            <p className="text-sm">جاري تحميل بيانات الموظفين...</p>
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="font-semibold text-slate-700">لا يوجد موظفون مطابقون</p>
            <p className="text-xs text-slate-400 mt-1">ابدأ بإضافة موظف جديد لتسجيل بياناته وحركات حضوره</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 text-xs font-semibold">
                <tr>
                  <th className="py-3.5 px-4">اسم الموظف</th>
                  <th className="py-3.5 px-4">الرقم الوظيفي</th>
                  <th className="py-3.5 px-4">القسم</th>
                  <th className="py-3.5 px-4">حالة الحساب</th>
                  <th className="py-3.5 px-4">ربط الجهاز</th>
                  <th className="py-3.5 px-4 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/60 transition">
                    <td className="py-3.5 px-4 font-semibold text-slate-900">{emp.name}</td>
                    <td className="py-3.5 px-4">
                      <span className="font-mono bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-xs">
                        {emp.employee_code}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">{emp.department}</td>
                    <td className="py-3.5 px-4">
                      {emp.is_active ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                          نشط
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md">
                          موقوف
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">{getDeviceBadge(emp.device_status)}</td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => openEditModal(emp)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                          title="تعديل الموظف"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => toggleEmployeeStatus(emp)}
                          className={`p-1.5 rounded-lg transition cursor-pointer ${
                            emp.is_active
                              ? 'text-slate-500 hover:text-rose-600 hover:bg-rose-50'
                              : 'text-slate-500 hover:text-emerald-600 hover:bg-emerald-50'
                          }`}
                          title={emp.is_active ? 'إيقاف الموظف' : 'تفعيل الموظف'}
                        >
                          {emp.is_active ? (
                            <XCircle className="w-4 h-4" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4" />
                          )}
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

      {/* نافذة الإضافة / التعديل */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              {editingEmployee ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد'}
            </h3>
            <p className="text-xs text-slate-500 mb-5">
              {editingEmployee
                ? `تحديث معلومات ${editingEmployee.name}`
                : 'أدخل معلومات الموظف لتوليد سجله وتفعيل بصمته'}
            </p>

            {errorMsg && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم الموظف الثلاثي <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="مثال: محمد بن سعد القحطاني"
                  required
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                />
              </div>

              {editingEmployee ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الرقم التعريفي للموظف (4 أرقام)
                  </label>
                  <input
                    type="text"
                    value={formData.employee_code}
                    disabled
                    className="w-full border border-slate-200 bg-slate-100 text-slate-600 rounded-xl px-3.5 py-2.5 text-sm font-mono cursor-not-allowed"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    الرقم الوظيفي ثابت ولا يمكن تغييره لارتباطه بسجلات الحضور.
                  </p>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center justify-between">
                  <div>
                    <span className="font-bold block text-blue-800">الرقم التعريفي للبصمة (4 أرقام):</span>
                    <span className="text-slate-600">سيُخصّص له تلقائياً: <strong className="font-mono text-blue-700 text-sm">{nextSuggestedCode}</strong></span>
                  </div>
                  <span className="font-mono text-xs font-bold text-blue-700 bg-white border border-blue-200 px-2.5 py-1 rounded-lg shadow-xs">
                    توليد آلي ⚡
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  القسم / الإدارة <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  placeholder="مثال: الموارد البشرية، المبيعات..."
                  required
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                />
              </div>

              <div className="pt-3 flex gap-2.5 justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingEmployee ? 'حفظ التعديلات' : 'إضافة الموظف'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}


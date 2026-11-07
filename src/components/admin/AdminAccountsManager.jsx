import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { 
  ShieldCheck, UserPlus, RefreshCw, AlertCircle, 
  CheckCircle2, Loader2, KeyRound, Lock, Mail, User, ShieldAlert 
} from 'lucide-react'
import { formatArabicDateTime } from '../../lib/utils'

export default function AdminAccountsManager() {
  const { adminUser } = useAuth()
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // حقول إضافة مدير جديد
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    password: '',
    role: 'admin',
  })

  // جلب قائمة المدراء
  const fetchAdmins = async () => {
    try {
      setLoading(true)
      setErrorMsg('')
      const { data, error } = await supabase.rpc('get_admins_list')
      if (error) throw error
      setAdmins(data || [])
    } catch (err) {
      console.error('Failed to fetch admins:', err)
      setErrorMsg('تعذر جلب قائمة المدراء: ' + (err.message || 'خطأ غير معروف'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAdmins()
  }, [])

  // إضافة حساب مدير جديد
  const handleCreateAdmin = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    if (!formData.name.trim() || !formData.username.trim() || !formData.password) {
      setErrorMsg('يرجى ملء كافة الحقول.')
      return
    }

    if (formData.password.length < 6) {
      setErrorMsg('كلمة المرور يجب أن لا تقل عن 6 أحرف أو أرقام.')
      return
    }

    try {
      setSubmitting(true)
      let { data, error } = await supabase.rpc('create_admin', {
        p_name: formData.name.trim(),
        p_username: formData.username.trim().toLowerCase(),
        p_password: formData.password,
        p_role: formData.role,
      })

      // بديل ذكي في حال كانت قاعدة البيانات تستخدم p_email
      if (error && (error.code === 'PGRST202' || error.message?.includes('schema cache'))) {
        const fallbackRes = await supabase.rpc('create_admin', {
          p_name: formData.name.trim(),
          p_email: `${formData.username.trim().toLowerCase()}@punchlog.com`,
          p_password: formData.password,
          p_role: formData.role,
        })
        data = fallbackRes.data
        error = fallbackRes.error
      }

      if (error) throw error

      if (data && !data.success) {
        throw new Error(data.error)
      }

      setSuccessMsg(`تم إنشاء حساب المدير (${formData.name}) بنجاح باسم مستخدم (${formData.username.toLowerCase()}).`)
      setIsModalOpen(false)
      setFormData({ name: '', username: '', password: '', role: 'admin' })
      fetchAdmins()
    } catch (err) {
      setErrorMsg(err.message || 'حدث خطأ أثناء إنشاء الحساب.')
    } finally {
      setSubmitting(false)
    }
  }

  // تفعيل / إيقاف حساب مدير
  const handleToggleStatus = async (admin) => {
    if (admin.id === adminUser?.id) {
      alert('لا يمكنك إيقاف حسابك الحالي الذي تستخدمه لتسجيل الدخول!')
      return
    }

    const actionText = admin.is_active ? 'إيقاف' : 'تفعيل'
    if (!window.confirm(`هل أنت متأكد من ${actionText} حساب المدير "${admin.name}"؟`)) {
      return
    }

    try {
      const { data, error } = await supabase.rpc('toggle_admin_status', {
        p_admin_id: admin.id,
      })

      if (error) throw error
      if (data && !data.success) throw new Error(data.error)

      setSuccessMsg(`تم تحديث حالة حساب (${admin.name}) بنجاح.`)
      fetchAdmins()
    } catch (err) {
      alert('فشل تغيير الحالة: ' + err.message)
    }
  }

  const getRoleBadge = (role) => {
    switch (role) {
      case 'super_admin':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-0.5 rounded-full">
            مدير عام
          </span>
        )
      case 'supervisor':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
            مشرف فرع
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-full">
            مدير
          </span>
        )
    }
  }

  return (
    <div className="space-y-6">
      {/* الشريط العلوي */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            إدارة حسابات المدراء ({admins.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            حسابات المدراء محفوظة ومشفّرة في جدول <code>admins</code> بقاعدة البيانات، ويمكن إضافة عدة مدراء بصلاحيات مختلفة.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={fetchAdmins}
            disabled={loading}
            className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
            title="تحديث القائمة"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => {
              setErrorMsg('')
              setIsModalOpen(true)
            }}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>إضافة حساب مدير</span>
          </button>
        </div>
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

      {/* جدول حسابات المدراء */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
            <p className="text-sm">جاري جلب حسابات المدراء من قاعدة البيانات...</p>
          </div>
        ) : admins.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <ShieldAlert className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="font-semibold text-slate-700">لا توجد حسابات مسجلة في جدول admins</p>
            <p className="text-xs text-slate-400 mt-1">
              تأكد من تطبيق سكربت <code>004_admins_table.sql</code> في Supabase SQL Editor.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-semibold">
                <tr>
                  <th className="py-3.5 px-4">اسم المدير</th>
                  <th className="py-3.5 px-4">اسم المستخدم (Username)</th>
                  <th className="py-3.5 px-4">الصلاحية</th>
                  <th className="py-3.5 px-4">الحالة</th>
                  <th className="py-3.5 px-4">آخر تسجيل دخول</th>
                  <th className="py-3.5 px-4">تاريخ الإنشاء</th>
                  <th className="py-3.5 px-4 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {admins.map((adm) => {
                  const isCurrent = adm.id === adminUser?.id
                  return (
                    <tr key={adm.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        <div className="flex items-center gap-2">
                          <span>{adm.name}</span>
                          {isCurrent && (
                            <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-normal">
                              حسابك الحالي
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-blue-600 font-semibold">
                        @{adm.username || adm.email?.split('@')[0]}
                      </td>
                      <td className="py-3.5 px-4">{getRoleBadge(adm.role)}</td>
                      <td className="py-3.5 px-4">
                        {adm.is_active ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                            نشط
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-full">
                            موقوف
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500">
                        {adm.last_login_at ? formatArabicDateTime(adm.last_login_at) : 'لم يسجل بعد'}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-400">
                        {formatArabicDateTime(adm.created_at)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {!isCurrent && (
                          <button
                            onClick={() => handleToggleStatus(adm)}
                            className={`text-xs font-semibold px-3 py-1 rounded-lg border transition cursor-pointer ${
                              adm.is_active
                                ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                                : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                            }`}
                          >
                            {adm.is_active ? 'إيقاف الحساب' : 'تفعيل الحساب'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* نافذة إضافة مدير جديد */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 mb-1">إضافة حساب مدير جديد</h3>
            <p className="text-xs text-slate-500 mb-5">
              سيتم حفظ الحساب وتشفير كلمة المرور تلقائياً في جدول <code>admins</code> بقاعدة البيانات.
            </p>

            {errorMsg && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleCreateAdmin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم المدير الكامل <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="مثال: م. فهد السالم"
                    required
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm pl-10 focus:outline-none focus:border-blue-500 transition"
                  />
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم المستخدم (Username) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    placeholder="مثال: fahad, manager, admin2"
                    required
                    minLength={3}
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm pl-10 focus:outline-none focus:border-blue-500 transition font-mono"
                  />
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  * 3 أحرف على الأقل (يُستخدم لتسجيل الدخول بدلاً من الإيميل).
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  كلمة المرور (تُشفّر في قاعدة البيانات) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm pl-10 focus:outline-none focus:border-blue-500 transition font-mono"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  * 6 خانات كحد أدنى. تُشفّر تلقائياً بخوارزمية Blowfish في PostgreSQL.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  مستوى الصلاحية
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition cursor-pointer"
                >
                  <option value="admin">مدير (إدارة كاملة للموظفين والبصمة)</option>
                  <option value="supervisor">مشرف فرع</option>
                  <option value="super_admin">مدير عام (Super Admin)</option>
                </select>
              </div>

              <div className="pt-3 flex gap-2.5 justify-end">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
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
                  <span>حفظ وتشفير الحساب</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}


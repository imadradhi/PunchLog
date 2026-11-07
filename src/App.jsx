import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import EmployeePunch from './pages/employee/EmployeePunch'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminLogin from './pages/admin/AdminLogin'
import { Loader2 } from 'lucide-react'

/**
 * حارس مسار الإدارة (Route Guard)
 * يضمن بقاء /admin محمي باسم المستخدم وكلمة المرور
 * بينما يبقى المسار الرئيسي "/" عاماً بالكامل ومفتوحاً للموظفين بدون أي تسجيل دخول
 */
function AdminRouteGuard() {
  const { adminUser, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white font-sans">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
        <p className="text-sm text-slate-400">جاري التحقق من جلسة الإدارة...</p>
      </div>
    )
  }

  // إذا لم يكن المدير مسجل الدخول، يُعرض نموذج تسجيل الدخول باسم المستخدم
  return adminUser ? <AdminDashboard /> : <AdminLogin />
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* المسار الأساسي (صفحة الموظف): عامة ومفتوحة بالكامل بدون أي مصادقة أو قيود */}
          <Route path="/" element={<EmployeePunch />} />

          {/* مسار لوحة الإدارة: محمي بحارس الصلاحيات */}
          <Route path="/admin" element={<AdminRouteGuard />} />

          {/* أي مسار آخر غير معرّف يُعاد توجيهه تلقائياً إلى صفحة الموظف العامة */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

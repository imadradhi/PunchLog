import React, { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import AdminLogin from './AdminLogin'
import EmployeeManager from '../../components/admin/EmployeeManager'
import LocationManager from '../../components/admin/LocationManager'
import QrDisplay from '../../components/admin/QrDisplay'
import DeviceRequests from '../../components/admin/DeviceRequests'
import AttendanceLog from '../../components/admin/AttendanceLog'
import AdminAccountsManager from '../../components/admin/AdminAccountsManager'
import { 
  ShieldCheck, Users, MapPin, QrCode, 
  History, Smartphone, LogOut, Loader2, ArrowRight, UserCog 
} from 'lucide-react'

export default function AdminDashboard() {
  const { adminUser, loading, signOut } = useAuth()
  const [activeTab, setActiveTab] = useState('employees') // 'employees' | 'location' | 'qr' | 'devices' | 'attendance' | 'admins'

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
        <p className="text-sm text-slate-400">جاري التحقق من صلاحيات الدخول...</p>
      </div>
    )
  }

  // إذا لم يكن مسجل الدخول، اعرض شاشة تسجيل الدخول
  if (!adminUser) {
    return <AdminLogin />
  }

  const navItems = [
    { id: 'employees', label: 'الموظفون', icon: Users },
    { id: 'location', label: 'موقع العمل (Geofencing)', icon: MapPin },
    { id: 'qr', label: 'شاشة الباركود المتغير (QR)', icon: QrCode },
    { id: 'devices', label: 'طلبات ربط الأجهزة', icon: Smartphone },
    { id: 'attendance', label: 'سجل الحضور والانصراف', icon: History },
    { id: 'admins', label: 'حسابات المدراء', icon: UserCog },
  ]

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-800">
      {/* الشريط العلوي العام */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <img
                src="/logo.png"
                alt="PunchLog Logo"
                className="w-10 h-10 rounded-xl object-contain shadow-sm border border-slate-100"
              />
              <div>
                <h1 className="text-base font-bold text-slate-900 leading-tight">
                  PunchLog <span className="text-blue-600 font-semibold text-xs">Admin</span>
                </h1>
                <p className="text-[11px] text-slate-400">لوحة التحكم وإدارة البصمة</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <a
                href="/"
                target="_blank"
                rel="noreferrer"
                className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg transition"
              >
                <span>شاشة الموظف</span>
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </a>

              <div className="h-6 w-px bg-slate-200 hidden sm:block" />

              {/* بيانات المدير الحالي من قاعدة البيانات */}
              <div className="text-left hidden sm:block">
                <p className="text-xs font-bold text-slate-800 truncate max-w-[180px]">
                  {adminUser.name || adminUser.username}
                </p>
                <p className="text-[10px] text-emerald-600 font-medium">
                  {adminUser.role === 'super_admin' ? 'مدير عام' : 'مدير معتمد'} (@{adminUser.username || adminUser.name})
                </p>
              </div>

              <button
                onClick={signOut}
                className="inline-flex items-center gap-1.5 text-xs text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-200 hover:border-rose-600 px-3 py-1.5 rounded-lg transition cursor-pointer font-medium"
                title="تسجيل الخروج"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">خروج</span>
              </button>
            </div>
          </div>

          {/* تبويبات التنقل */}
          <div className="flex overflow-x-auto gap-1 border-t border-slate-100 py-2 scrollbar-none">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = activeTab === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </header>

      {/* المحتوى الرئيسي */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'employees' && <EmployeeManager />}
        {activeTab === 'location' && <LocationManager />}
        {activeTab === 'qr' && <QrDisplay />}
        {activeTab === 'devices' && <DeviceRequests />}
        {activeTab === 'attendance' && <AttendanceLog />}
        {activeTab === 'admins' && <AdminAccountsManager />}
      </main>
    </div>
  )
}

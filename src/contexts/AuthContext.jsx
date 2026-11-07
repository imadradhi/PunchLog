import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

const AuthContext = createContext({})

export const AuthProvider = ({ children }) => {
  const [adminUser, setAdminUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isConfigured, setIsConfigured] = useState(isSupabaseConfigured())

  // استرجاع جلسة المدير المحفوظة عند التحميل
  useEffect(() => {
    setIsConfigured(isSupabaseConfigured())

    const storedAdmin = localStorage.getItem('punchlog_admin_session')
    if (storedAdmin) {
      try {
        setAdminUser(JSON.parse(storedAdmin))
      } catch {
        localStorage.removeItem('punchlog_admin_session')
      }
    }
    setLoading(false)
  }, [])

  // تسجيل الدخول بالاعتماد على جدول admins في قاعدة البيانات
  const signIn = async (email, password) => {
    if (!isConfigured) {
      throw new Error('يرجى ضبط بيانات الاتصال بـ Supabase في ملف .env أولاً')
    }

    // 1. محاولة تسجيل الدخول عبر جدول المدراء المشفّر (Database Admins Table)
    const { data, error } = await supabase.rpc('admin_login', {
      p_email: email.trim().toLowerCase(),
      p_password: password,
    })

    if (!error && data) {
      if (!data.success) {
        throw new Error(data.error || 'فشل تسجيل الدخول')
      }

      // حفظ جلسة المدير
      const adminData = data.admin
      setAdminUser(adminData)
      localStorage.setItem('punchlog_admin_session', JSON.stringify(adminData))
      return adminData
    }

    // 2. محاولة بديلة عبر Supabase Auth في حال كان الحساب مسجلاً هناك
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (!authError && authData?.user) {
        const fallbackAdmin = {
          id: authData.user.id,
          name: authData.user.user_metadata?.name || 'مدير النظام',
          email: authData.user.email,
          role: 'admin',
        }
        setAdminUser(fallbackAdmin)
        localStorage.setItem('punchlog_admin_session', JSON.stringify(fallbackAdmin))
        return fallbackAdmin
      }
    } catch {
      // تجاهل
    }

    throw new Error(error?.message || 'بيانات الدخول غير صحيحة، يرجى التحقق من البريد وكلمة المرور.')
  }

  // تسجيل الخروج
  const signOut = async () => {
    setAdminUser(null)
    localStorage.removeItem('punchlog_admin_session')
    try {
      await supabase.auth.signOut()
    } catch {
      // تجاهل
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user: adminUser,
        adminUser,
        loading,
        signIn,
        signOut,
        isConfigured,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

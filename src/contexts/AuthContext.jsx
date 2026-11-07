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

  // تسجيل الدخول الذكي باسم المستخدم
  const signIn = async (usernameInput, password) => {
    if (!isConfigured) {
      throw new Error('يرجى ضبط بيانات الاتصال بـ Supabase في ملف .env أولاً')
    }

    const cleanInput = usernameInput.trim().toLowerCase()

    // احتمالات اسم المستخدم (كنص مجرد أو كحساب بنطاق النظام)
    const candidates = cleanInput.includes('@')
      ? [cleanInput]
      : [cleanInput, `${cleanInput}@punchlog.com`]

    let lastError = null

    for (const candidate of candidates) {
      // 1. تجربة مع معامل p_username
      try {
        const { data, error } = await supabase.rpc('admin_login', {
          p_username: candidate,
          p_password: password,
        })
        if (!error && data?.success) {
          const adminData = {
            ...data.admin,
            username: cleanInput,
          }
          setAdminUser(adminData)
          localStorage.setItem('punchlog_admin_session', JSON.stringify(adminData))
          return adminData
        }
        if (data && !data.success) lastError = data.error
      } catch (err) {
        // الاستمرار للتجربة التالية
      }

      // 2. تجربة مع معامل p_email
      try {
        const { data, error } = await supabase.rpc('admin_login', {
          p_email: candidate,
          p_password: password,
        })
        if (!error && data?.success) {
          const adminData = {
            ...data.admin,
            username: cleanInput,
          }
          setAdminUser(adminData)
          localStorage.setItem('punchlog_admin_session', JSON.stringify(adminData))
          return adminData
        }
        if (data && !data.success) lastError = data.error
      } catch (err) {
        // الاستمرار للتجربة التالية
      }
    }

    throw new Error(lastError || 'بيانات الدخول غير صحيحة، يرجى التحقق من اسم المستخدم وكلمة المرور.')
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

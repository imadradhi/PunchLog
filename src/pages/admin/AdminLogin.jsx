import React, { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { ShieldCheck, User, Lock, AlertCircle, Loader2 } from 'lucide-react'

export default function AdminLogin({ onLoginSuccess }) {
  const { signIn, isConfigured } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    if (!username.trim() || !password) {
      setErrorMsg('يرجى إدخال اسم المستخدم وكلمة المرور.')
      return
    }

    try {
      setLoading(true)
      await signIn(username.trim(), password)
      if (onLoginSuccess) onLoginSuccess()
    } catch (err) {
      setErrorMsg(err.message || 'بيانات الدخول غير صحيحة، يرجى المحاولة ثانية.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-800/90 border border-slate-700/80 rounded-3xl p-8 shadow-2xl backdrop-blur-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600/20 text-blue-400 mb-4 border border-blue-500/30">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-white">تسجيل دخول الإدارة</h1>
          <p className="text-slate-400 text-sm mt-1.5">بوابة إدارة بصمة الحضور PunchLog</p>
        </div>

        {!isConfigured && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-950/60 border border-amber-600/40 text-amber-200 text-xs leading-relaxed flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-300">تنبيه إعدادات Supabase</p>
              <p className="mt-1 text-slate-300">
                يرجى إضافة مفاتيح <code>VITE_SUPABASE_URL</code> و <code>VITE_SUPABASE_ANON_KEY</code> في ملف <code>.env</code> للاتصال بقاعدة البيانات.
              </p>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="mb-6 p-3.5 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              اسم المستخدم (Username)
            </label>
            <div className="relative">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="مثال: admin"
                required
                autoComplete="username"
                className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-3 pl-10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm transition font-mono"
              />
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              كلمة المرور
            </label>
            <div className="relative">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-3 pl-10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm transition"
              />
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-blue-600/30 transition flex items-center justify-center gap-2 text-sm mt-2 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>جاري تسجيل الدخول...</span>
              </>
            ) : (
              <span>تسجيل الدخول</span>
            )}
          </button>
        </form>

        <div className="mt-8 pt-4 border-t border-slate-700/60 text-center space-y-2">
          <p className="text-[11px] text-slate-400">
            الحساب الافتراضي: اسم المستخدم <code className="text-blue-400 font-mono bg-slate-900/80 px-1.5 py-0.5 rounded">admin</code> | كلمة المرور <code className="text-blue-400 font-mono bg-slate-900/80 px-1.5 py-0.5 rounded">admin123</code>
          </p>
          <div>
            <a href="/" className="text-xs text-slate-400 hover:text-blue-400 transition">
              العودة لشاشة الموظف &larr;
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}


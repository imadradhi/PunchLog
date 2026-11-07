import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import QRCode from 'qrcode'
import { 
  QrCode, RefreshCw, Maximize2, Minimize2, 
  Clock, MapPin, AlertCircle, ShieldCheck, CheckCircle2 
} from 'lucide-react'

export default function QrDisplay() {
  const [locations, setLocations] = useState([])
  const [selectedLocationId, setSelectedLocationId] = useState(null)
  const [tokenData, setTokenData] = useState(null)
  const [timeLeft, setTimeLeft] = useState(10)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())

  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const intervalRef = useRef(null)
  const countdownRef = useRef(null)

  // تحديث الساعة الحية كل ثانية
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // جلب مواقع العمل المتاحة
  useEffect(() => {
    async function loadLocations() {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('locations')
          .select('id, name')
          .order('created_at', { ascending: true })

        if (error) throw error

        if (data && data.length > 0) {
          setLocations(data)
          setSelectedLocationId(data[0].id)
        } else {
          setErrorMsg('لا توجد مواقع عمل مسجلة. يرجى إضافة موقع من تبويب "موقع العمل" أولاً.')
        }
      } catch (err) {
        console.error('Error fetching locations:', err)
        setErrorMsg('تعذر جلب مواقع العمل: ' + (err.message || 'خطأ في الاتصال'))
      } finally {
        setLoading(false)
      }
    }

    loadLocations()
  }, [])

  // دالة طلب رمز QR جديد من الخادم
  const fetchNewToken = async (locId) => {
    const targetId = locId || selectedLocationId
    if (!targetId) return

    try {
      setGenerating(true)
      // استدعاء دالة توليد الرمز في قاعدة البيانات (Server-side generator)
      const { data, error } = await supabase.rpc('generate_server_qr', {
        p_location_id: targetId,
      })

      if (error) throw error

      setTokenData(data)
      setTimeLeft(10) // إعادة تعيين العداد لـ 10 ثوانٍ
      renderQrCanvas(data.token)
    } catch (err) {
      console.error('Error generating QR token:', err)
      // في حال لم تُنفّذ دالة RPC بعد، نستخدم إنشاء مباشر مشفر كبديل مؤقت آمن
      fallbackTokenGeneration(targetId)
    } finally {
      setGenerating(false)
    }
  }

  // آلية بديلة لتوليد الرمز في حال تأخر تفعيل الـ RPC
  const fallbackTokenGeneration = async (locId) => {
    try {
      const randomBytes = new Uint8Array(20)
      crypto.getRandomValues(randomBytes)
      const token = Array.from(randomBytes, (b) => b.toString(16).padStart(2, '0')).join('')
      const expiresAt = new Date(Date.now() + 15 * 1000).toISOString() // 15 ثانية

      const { data, error } = await supabase
        .from('qr_tokens')
        .insert([{ token, location_id: locId, expires_at: expiresAt, used: false }])
        .select()
        .single()

      if (error) throw error

      setTokenData({ token, expires_at: expiresAt, location_id: locId })
      setTimeLeft(10)
      renderQrCanvas(token)
    } catch (err) {
      setErrorMsg('تعذر إنشاء رمز الباركود: ' + err.message)
    }
  }

  // رسم الباركود على الكانفاس
  const renderQrCanvas = (token) => {
    if (!canvasRef.current || !token) return

    // ترميز نص الـ QR (JSON يحتوي على التوكن ومعرف الموقع لسهولة الفحص السريع)
    const payload = JSON.stringify({
      t: token,
      l: selectedLocationId,
    })

    QRCode.toCanvas(
      canvasRef.current,
      payload,
      {
        width: isFullscreen ? 360 : 280,
        margin: 2,
        color: {
          dark: '#0f172a', // slate-900
          light: '#ffffff',
        },
        errorCorrectionLevel: 'H', // أعلى دقة تصحيح أخطاء
      },
      (err) => {
        if (err) console.error('QR Render Error:', err)
      }
    )
  }

  // دورة حياة التحديث التلقائي كل 10 ثوانٍ
  useEffect(() => {
    if (!selectedLocationId) return

    // جلب أول رمز مباشرة
    fetchNewToken(selectedLocationId)

    // عداد ثوانٍ تنازلي
    countdownRef.current = setInterval(() => {
      setTimeLeft((prev) => (prev > 1 ? prev - 1 : 10))
    }, 1000)

    // تجديد الرمز كل 10 ثوانٍ
    intervalRef.current = setInterval(() => {
      fetchNewToken(selectedLocationId)
    }, 10000)

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [selectedLocationId])

  // إعادة رسم الـ QR إذا تغير حجم الشاشة الكاملة
  useEffect(() => {
    if (tokenData?.token) {
      renderQrCanvas(tokenData.token)
    }
  }, [isFullscreen])

  // التبديل إلى وضع ملء الشاشة (Kiosk mode)
  const toggleFullscreen = () => {
    if (!containerRef.current) return

    if (!document.fullscreenElement) {
      containerRef.current
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch((err) => alert('تعذر تفعيل ملء الشاشة: ' + err.message))
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false))
    }
  }

  // الاستماع لتغيير وضع ملء الشاشة عبر زر ESC
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [])

  const selectedLocation = locations.find((l) => l.id === selectedLocationId)

  return (
    <div
      ref={containerRef}
      className={`transition-all duration-300 ${
        isFullscreen
          ? 'fixed inset-0 z-50 bg-slate-950 text-white flex flex-col items-center justify-center p-8'
          : 'space-y-6'
      }`}
    >
      {/* الشريط العلوي في العرض العادي */}
      {!isFullscreen && (
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <QrCode className="w-5 h-5 text-blue-600" />
              شاشة الباركود الذكي المتجدد (Live QR Kiosk)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              يتجدد الرمز تلقائياً كل 10 ثوانٍ لحماية البصمة ومنع تصوير الرمز أو مشاركته
            </p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {locations.length > 1 && (
              <select
                value={selectedLocationId || ''}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-blue-500"
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={toggleFullscreen}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer shadow-sm"
              title="عرض الشاشة في وضع الاستقبال الكامل"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>وضع شاشة الاستقبال (ملء الشاشة)</span>
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* بطاقة عرض الباركود والعداد */}
      <div
        className={`mx-auto bg-white rounded-3xl shadow-lg border border-slate-200 text-center flex flex-col items-center justify-center ${
          isFullscreen
            ? 'p-10 max-w-lg bg-slate-900 border-slate-800 text-white shadow-2xl'
            : 'p-8 max-w-md'
        }`}
      >
        {/* رأس البطاقة: الموقع والساعة */}
        <div className="mb-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 mb-2">
            <MapPin className="w-3.5 h-3.5 text-blue-600" />
            <span>{selectedLocation?.name || 'موقع العمل'}</span>
          </div>
          <div className="flex items-center justify-center gap-1.5 text-sm font-mono font-semibold text-slate-600">
            <Clock className="w-4 h-4 text-slate-400" />
            <span>
              {currentTime.toLocaleTimeString('ar-SA', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
              })}
            </span>
          </div>
        </div>

        {/* مربع الكانفاس الحاوي للباركود */}
        <div className="relative p-4 bg-white rounded-2xl shadow-inner border border-slate-100 flex items-center justify-center">
          <canvas ref={canvasRef} className="rounded-xl transition-all" />
          {generating && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-xs flex items-center justify-center rounded-2xl">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          )}
        </div>

        {/* عداد الثواني والشريط التقدمي */}
        <div className="w-full mt-6 space-y-2">
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className={isFullscreen ? 'text-slate-400' : 'text-slate-500'}>
              يتجدد الرمز خلال:
            </span>
            <span className="font-mono text-sm font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              {timeLeft} ثوانٍ
            </span>
          </div>

          {/* شريط التقدم التنازلي */}
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-1000 ease-linear rounded-full"
              style={{ width: `${(timeLeft / 10) * 100}%` }}
            />
          </div>
        </div>

        {/* تعليمات وتأكيدات الأمان */}
        <div className="mt-6 pt-4 border-t border-slate-100 w-full text-xs text-slate-400 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>رمز خادم مؤمّن مشفر ذو استخدام لمرة واحدة (10 ثوانٍ)</span>
        </div>

        {isFullscreen && (
          <button
            onClick={toggleFullscreen}
            className="mt-6 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white transition cursor-pointer"
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span>الخروج من ملء الشاشة (ESC)</span>
          </button>
        )}
      </div>
    </div>
  )
}


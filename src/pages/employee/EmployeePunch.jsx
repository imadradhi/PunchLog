import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { Html5Qrcode } from 'html5-qrcode'
import { 
  QrCode, Smartphone, MapPin, User, CheckCircle2, 
  AlertCircle, Camera, RefreshCw, X, ShieldCheck, 
  ArrowDownRight, ArrowUpLeft, Loader2, Navigation, Clock 
} from 'lucide-react'
import { getOrCreateDeviceId, calculateDistance, formatArabicDateTime } from '../../lib/utils'
import { submitCheckIn } from '../../lib/checkInService'

export default function EmployeePunch() {
  const deviceId = getOrCreateDeviceId()

  // حالة الموظف
  const [employeeCode, setEmployeeCode] = useState(
    localStorage.getItem('punchlog_last_code') || ''
  )
  const [rememberCode, setRememberCode] = useState(true)

  // حالة الموقع و GPS
  const [location, setLocation] = useState(null)
  const [gpsStatus, setGpsStatus] = useState('idle') // 'idle' | 'locating' | 'granted' | 'denied'
  const [userCoords, setUserCoords] = useState(null) // { lat, lng, accuracy }
  const [distanceToWork, setDistanceToWork] = useState(null) // بالمتر
  const [isInRange, setIsInRange] = useState(false)
  const [gpsError, setGpsError] = useState('')

  // حالة الماسح والكاميرا
  const [isScanning, setIsScanning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const scannerRef = useRef(null)

  // نتيجة العملية (نجاح / تنبيه / خطأ)
  const [punchResult, setPunchResult] = useState(null)

  // جلب موقع العمل الأساسي
  useEffect(() => {
    async function fetchWorkLocation() {
      try {
        const { data, error } = await supabase
          .from('locations')
          .select('*')
          .order('created_at', { ascending: true })
          .limit(1)

        if (error) throw error
        if (data && data.length > 0) {
          setLocation(data[0])
        }
      } catch (err) {
        console.error('Failed to load work location:', err)
      }
    }
    fetchWorkLocation()
  }, [])

  // دالة طلب وتحديث إحداثيات GPS للموظف
  const requestLocation = () => {
    if (!navigator.geolocation) {
      setGpsStatus('denied')
      setGpsError('متصفحك لا يدعم تحديد الموقع الجغرافي GPS.')
      return
    }

    setGpsStatus('locating')
    setGpsError('')

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }
        setUserCoords(coords)
        setGpsStatus('granted')

        // حساب المسافة إذا كان موقع العمل متوفراً
        if (location) {
          const distance = calculateDistance(
            coords.lat,
            coords.lng,
            location.lat,
            location.lng
          )
          setDistanceToWork(distance)
          setIsInRange(distance <= location.radius_m)
        }
      },
      (err) => {
        setGpsStatus('denied')
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError('تم رفض إذن تحديد الموقع. يرجى تفعيل إذن الـ GPS في إعدادات المتصفح.')
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGpsError('إشارة الموقع غير متوفرة. تأكد من تفعيل خدمة الموقع في هاتفك.')
        } else {
          setGpsError('انتهت مهلة جلب الموقع. يرجى المحاولة في مكان مكشوف.')
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 5000,
      }
    )
  }

  // إعادة حساب المسافة عند جلب موقع العمل
  useEffect(() => {
    if (location && userCoords) {
      const distance = calculateDistance(
        userCoords.lat,
        userCoords.lng,
        location.lat,
        location.lng
      )
      setDistanceToWork(distance)
      setIsInRange(distance <= location.radius_m)
    }
  }, [location, userCoords])

  // بدء مسح الكاميرا للباركود
  const startScanner = async () => {
    if (!employeeCode.trim()) {
      alert('يرجى إدخال الرقم الوظيفي أولاً.')
      return
    }

    if (!isInRange) {
      alert('لا يمكنك فتح الكاميرا لأنك خارج نطاق موقع العمل!')
      return
    }

    if (rememberCode) {
      localStorage.setItem('punchlog_last_code', employeeCode.trim().toUpperCase())
    }

    setPunchResult(null)
    setIsScanning(true)

    // انتظار رندر عنصر الكانفاس في الـ DOM
    setTimeout(async () => {
      try {
        const html5QrCode = new Html5Qrcode('qr-reader')
        scannerRef.current = html5QrCode

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        }

        await html5QrCode.start(
          { facingMode: 'environment' }, // الكاميرا الخلفية للهاتف
          config,
          handleScanSuccess,
          (errorMessage) => {
            // أخطاء الإطارات الفارغة (تجاهل أثناء المسح)
          }
        )
      } catch (err) {
        console.error('Camera start failed:', err)
        alert('تعذر فتح الكاميرا: تأكد من منح المتصفح إذن الوصول للكاميرا.')
        setIsScanning(false)
      }
    }, 200)
  }

  // إيقاف الماسح
  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop()
        scannerRef.current.clear()
      } catch (err) {
        console.error('Error stopping scanner:', err)
      }
      scannerRef.current = null
    }
    setIsScanning(false)
  }

  // معالجة قراءة الباركود بنجاح
  const handleScanSuccess = async (decodedText) => {
    // إيقاف الكاميرا فوراً لمنع التكرار
    await stopScanner()

    let token = decodedText
    let targetLocationId = location?.id

    // فحص ما إذا كان الرمز بتنسيق JSON المعياري { t: "...", l: "..." }
    try {
      const parsed = JSON.parse(decodedText)
      if (parsed.t) token = parsed.t
      if (parsed.l) targetLocationId = parsed.l
    } catch {
      // الرمز كنص خام
    }

    await processPunch(token, targetLocationId)
  }

  // إرسال الطلب إلى الخادم
  const processPunch = async (token, locId) => {
    try {
      setSubmitting(true)
      setPunchResult(null)

      const response = await submitCheckIn({
        employee_code: employeeCode,
        device_id: deviceId,
        token: token,
        location_id: locId || location?.id,
        lat: userCoords?.lat,
        lng: userCoords?.lng,
        accuracy: userCoords?.accuracy || 10,
      })

      if (response.success) {
        // اهتزاز الهاتف عند النجاح
        if (navigator.vibrate) navigator.vibrate([100, 50, 100])
        setPunchResult({
          status: 'success',
          type: response.type,
          title: response.type === 'in' ? 'تم تسجيل الحضور بنجاح' : 'تم تسجيل الانصراف بنجاح',
          message: response.message,
          employee_name: response.employee_name,
          time: new Date().toLocaleTimeString('ar-SA', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }),
        })
      } else {
        if (response.is_device_pending) {
          setPunchResult({
            status: 'pending',
            title: 'بانتظار موافقة مدير النظام',
            message: response.error,
          })
        } else {
          setPunchResult({
            status: 'error',
            title: 'تعذر تسجيل البصمة',
            message: response.error || 'حدث خطأ في معالجة الطلب.',
          })
        }
      }
    } catch (err) {
      setPunchResult({
        status: 'error',
        title: 'خطأ في الاتصال بالخادم',
        message: err.message || 'يرجى التحقق من اتصالك بالإنترنت والمحاولة مجدداً.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white flex flex-col justify-between p-4 sm:p-6 selection:bg-blue-600">
      <div className="max-w-md w-full mx-auto space-y-5">
        {/* الترويسة وشعار التطبيق */}
        <header className="text-center pt-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600/20 text-blue-400 mb-2.5 border border-blue-500/30 shadow-lg shadow-blue-500/10">
            <QrCode className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">PunchLog</h1>
          <p className="text-xs text-slate-400 mt-0.5">بصمة الحضور والانصراف الذكية</p>
        </header>

        {/* بطاقة إدخال الرقم الوظيفي ومعرّف الجهاز */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl backdrop-blur-md space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-blue-400" />
                الرقم التعريفي للموظف (4 أرقام)
              </span>
              <span className="text-[10px] text-slate-500 font-mono">مثال: 1001</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value.trim())}
              placeholder="1001"
              className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-2xl px-4 py-3 text-lg font-mono text-center font-bold tracking-widest placeholder-slate-700 transition outline-none"
            />
          </div>

          {/* معرّف الجهاز */}
          <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-400">
              <Smartphone className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span>معرّف هذا الهاتف:</span>
            </div>
            <span className="font-mono text-[11px] text-slate-300 select-all truncate max-w-[150px]">
              {deviceId.slice(0, 8)}...{deviceId.slice(-4)}
            </span>
          </div>
        </div>

        {/* بطاقة التحقق من الموقع الجغرافي (GPS Geofence) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold text-slate-200">
                {location ? location.name : 'موقع العمل'}
              </span>
            </div>

            <button
              onClick={requestLocation}
              disabled={gpsStatus === 'locating'}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300 bg-blue-950/50 hover:bg-blue-900/50 border border-blue-800/50 px-2.5 py-1.5 rounded-xl transition cursor-pointer"
            >
              <Navigation className={`w-3 h-3 ${gpsStatus === 'locating' ? 'animate-spin' : ''}`} />
              <span>{gpsStatus === 'granted' ? 'تحديث الموقع' : 'تحديد موقعي (GPS)'}</span>
            </button>
          </div>

          {/* حالة الموقع الحالية */}
          {!location && (
            <div className="p-3.5 rounded-2xl bg-amber-950/50 border border-amber-900/50 text-amber-200 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>جاري انتظار تطبيق سكربت قاعدة البيانات (SQL) لجلب إحداثيات موقع العمل...</span>
            </div>
          )}

          {location && gpsStatus === 'idle' && (
            <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 text-slate-400 text-xs text-center">
              اضغط على "تحديد موقعي" للتأكد من وجودك داخل نطاق المنشأة قبل المسح.
            </div>
          )}

          {location && gpsStatus === 'locating' && (
            <div className="p-3.5 rounded-2xl bg-blue-950/40 border border-blue-900/50 text-blue-300 text-xs flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span>جاري الاتصال بالأقمار الصناعية وتحديد إحداثياتك بدقة...</span>
            </div>
          )}

          {gpsStatus === 'denied' && (
            <div className="p-3.5 rounded-2xl bg-red-950/50 border border-red-900/50 text-red-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{gpsError}</span>
            </div>
          )}

          {location && gpsStatus === 'granted' && (
            <div className="space-y-2">
              <div
                className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs font-semibold ${
                  isInRange
                    ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
                    : 'bg-amber-950/40 border-amber-800/50 text-amber-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isInRange ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <span>
                    {isInRange
                      ? `أنت داخل نطاق العمل (${distanceToWork ?? 0} متراً من المركز)`
                      : `أنت خارج نطاق العمل (${distanceToWork ?? 'غير محدد'} متراً - المسموح ${location.radius_m}م)`}
                  </span>
                </div>
              </div>

              {userCoords?.accuracy && (
                <p className="text-[10px] text-slate-500 text-center font-mono">
                  دقة إشارة GPS الحالية: ±{Math.round(userCoords.accuracy)} متر
                </p>
              )}
            </div>
          )}
        </div>

        {/* زر فتح الكاميرا ومسح الباركود */}
        <div>
          <button
            onClick={startScanner}
            disabled={!isInRange || !employeeCode.trim() || submitting}
            className={`w-full py-4 px-6 rounded-2xl font-bold text-sm shadow-xl transition flex items-center justify-center gap-2.5 cursor-pointer ${
              isInRange && employeeCode.trim() && !submitting
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/30 active:scale-[0.98]'
                : 'bg-slate-800/80 text-slate-500 border border-slate-800 cursor-not-allowed opacity-60'
            }`}
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>جاري التحقق وتسجيل البصمة...</span>
              </>
            ) : (
              <>
                <Camera className="w-5 h-5" />
                <span>مسح باركود الحضور / الانصراف</span>
              </>
            )}
          </button>

          {!isInRange && gpsStatus === 'granted' && (
            <p className="text-[11px] text-amber-400/90 text-center mt-2">
              * يجب أن تتواجد داخل نطاق المقر لتفعيل زر مسح الباركود.
            </p>
          )}
          {!employeeCode.trim() && (
            <p className="text-[11px] text-slate-500 text-center mt-2">
              * أدخل رقمك الوظيفي أولاً لتفعيل البصمة.
            </p>
          )}
        </div>

        {/* بطاقة عرض النتيجة (نجاح / تنبيه / خطأ) */}
        {punchResult && (
          <div
            className={`p-5 rounded-3xl border shadow-2xl transition-all animate-in fade-in ${
              punchResult.status === 'success'
                ? 'bg-emerald-950/70 border-emerald-700/60 text-white'
                : punchResult.status === 'pending'
                ? 'bg-amber-950/70 border-amber-700/60 text-white'
                : 'bg-rose-950/70 border-rose-700/60 text-white'
            }`}
          >
            <div className="flex items-start gap-3">
              {punchResult.status === 'success' && (
                <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-2xl border border-emerald-500/30">
                  {punchResult.type === 'in' ? (
                    <ArrowDownRight className="w-6 h-6" />
                  ) : (
                    <ArrowUpLeft className="w-6 h-6" />
                  )}
                </div>
              )}
              {punchResult.status === 'pending' && (
                <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30">
                  <Smartphone className="w-6 h-6" />
                </div>
              )}
              {punchResult.status === 'error' && (
                <div className="p-2.5 bg-rose-500/20 text-rose-400 rounded-2xl border border-rose-500/30">
                  <AlertCircle className="w-6 h-6" />
                </div>
              )}

              <div className="flex-1">
                <h3 className="font-bold text-base leading-tight mb-1">
                  {punchResult.title}
                </h3>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {punchResult.message}
                </p>

                {punchResult.time && (
                  <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-300 font-mono">
                    <Clock className="w-3.5 h-3.5" />
                    <span>الوقت المعتمد: {punchResult.time}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* نافذة الكاميرا والماسح المنبثقة */}
      {isScanning && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl p-5 shadow-2xl relative">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-white">وجه الكاميرا نحو باركود الشاشة</span>
              </div>
              <button
                onClick={stopScanner}
                className="p-1.5 rounded-full bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* مربع معاينة الكاميرا */}
            <div className="overflow-hidden rounded-2xl bg-black aspect-square relative border-2 border-dashed border-blue-500/50">
              <div id="qr-reader" className="w-full h-full" />
            </div>

            <p className="text-[11px] text-slate-400 text-center mt-3">
              يتم قراءة الرمز لحظياً والتحقق من صلاحيته في الخادم فور مسحه.
            </p>
          </div>
        </div>
      )}

      {/* التذييل */}
      <footer className="text-center pt-6 pb-2 text-[11px] text-slate-500">
        <a href="/admin" className="text-slate-400 hover:text-blue-400 transition underline underline-offset-4">
          بوابة الإدارة والمشرفين &larr;
        </a>
      </footer>
    </div>
  )
}

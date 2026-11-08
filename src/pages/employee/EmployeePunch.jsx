import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { Html5Qrcode } from 'html5-qrcode'
import { 
  Smartphone, MapPin, User, CheckCircle2, 
  AlertCircle, Camera, RefreshCw, X, ShieldCheck, 
  ArrowDownRight, ArrowUpLeft, Loader2, Navigation, Clock, Search, ArrowRight, Compass, Calendar
} from 'lucide-react'
import { 
  getOrCreateDeviceId, getOrSyncDeviceId, getDeviceSummary,
  calculateDistance, formatArabicDateTime 
} from '../../lib/utils'
import { submitCheckIn } from '../../lib/checkInService'

export default function EmployeePunch() {
  const [deviceId, setDeviceId] = useState(() => getOrCreateDeviceId())
  const deviceSummary = getDeviceSummary()

  // مزامنة واسترجاع معرف الجهاز المتين عبر (localStorage + IndexedDB + Cookie)
  useEffect(() => {
    getOrSyncDeviceId().then((syncedId) => {
      if (syncedId && syncedId !== deviceId) {
        setDeviceId(syncedId)
      }
    })
  }, [])

  // ساعة وتاريخ النظام اللحظي
  const [currentTime, setCurrentTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // حالة الموظف والتحقق
  const [employeeCode, setEmployeeCode] = useState(
    localStorage.getItem('punchlog_last_code') || ''
  )
  const [verifiedEmployee, setVerifiedEmployee] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')

  // طريقة البصمة المختارة: 'qr' (مسح الباركود) أو 'gps' (بصمة الموقع)
  const [punchMethod, setPunchMethod] = useState('qr')

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

  // جلب موقع العمل الأساسي عند التحميل
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

  // 1. التحقق من هوية واسم الموظف عبر الرقم
  const handleVerifyEmployee = async (e) => {
    if (e) e.preventDefault()
    setVerifyError('')
    setPunchResult(null)

    const cleanCode = employeeCode.trim()
    if (!cleanCode) {
      setVerifyError('يرجى إدخال الرقم التعريفي للموظف.')
      return
    }

    try {
      setVerifying(true)
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, employee_code, department, is_active, device_status, device_id')
        .eq('employee_code', cleanCode)
        .maybeSingle()

      if (error) throw error

      if (!data) {
        setVerifiedEmployee(null)
        setVerifyError(`الرقم (${cleanCode}) غير مسجل في النظام. يرجى مراجعة إدارة الموارد البشرية.`)
        return
      }

      if (!data.is_active) {
        setVerifiedEmployee(null)
        setVerifyError(`حساب الموظف (${data.name}) موقوف حالياً من قبل الإدارة.`)
        return
      }

      setVerifiedEmployee(data)
      localStorage.setItem('punchlog_last_code', cleanCode)
    } catch (err) {
      console.error('Verify error:', err)
      setVerifyError(err.message || 'حدث خطأ في الاتصال بقاعدة البيانات.')
    } finally {
      setVerifying(false)
    }
  }

  // إعادة تعيين واختيار موظف آخر
  const handleResetEmployee = () => {
    setVerifiedEmployee(null)
    setVerifyError('')
    setPunchResult(null)
  }

  // طلب وتحديث إحداثيات GPS (خاص بطريقة البصمة الجغرافية)
  const requestLocation = () => {
    if (!navigator.geolocation) {
      setGpsStatus('denied')
      setGpsError('متصفحك لا يدعم تحديد الموقع الجغرافي GPS.')
      return
    }

    setGpsStatus('locating')
    setGpsError('')

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords
        setUserCoords({ lat: latitude, lng: longitude, accuracy })
        setGpsStatus('granted')

        if (location) {
          const distance = calculateDistance(
            latitude,
            longitude,
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
          setGpsError('تم رفض إذن تحديد الموقع. يرجى تفعيل إذن الـ GPS في إعدادات الهاتف.')
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

  // إعادة حساب المسافة عند توفر الموقع
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

  // =========================================================================
  // تنفيذ البصمة عبر مسح الباركود (QR Code) - الكاميرا مفعلة بالكامل بدون أي مربع
  // =========================================================================
  const startScanner = async () => {
    if (!verifiedEmployee) {
      alert('يرجى تأكيد هوية الموظف أولاً.')
      return
    }

    setPunchResult(null)
    setIsScanning(true)

    setTimeout(async () => {
      try {
        const html5QrCode = new Html5Qrcode('qr-reader')
        scannerRef.current = html5QrCode

        // مهم: عدم تمرير qrbox لإلغاء المربع الداخلي تماماً وتفعيل كامل الكاميرا للمسح
        const config = {
          fps: 15,
          aspectRatio: 1.0,
        }

        await html5QrCode.start(
          { facingMode: 'environment' },
          config,
          handleScanSuccess,
          () => {}
        )
      } catch (err) {
        console.error('Camera start failed:', err)
        alert('تعذر فتح الكاميرا: تأكد من منح المتصفح إذن الوصول للكاميرا.')
        setIsScanning(false)
      }
    }, 200)
  }

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

  const handleScanSuccess = async (decodedText) => {
    await stopScanner()

    let token = decodedText
    let targetLocationId = location?.id

    try {
      const parsed = JSON.parse(decodedText)
      if (parsed.t) token = parsed.t
      if (parsed.l) targetLocationId = parsed.l
    } catch {
      // نص خام
    }

    await executePunch({
      method: 'qr',
      token,
      locationId: targetLocationId,
    })
  }

  // =========================================================================
  // تنفيذ البصمة عبر الموقع الجغرافي (GPS)
  // =========================================================================
  const handleGpsPunch = async () => {
    if (!verifiedEmployee) {
      alert('يرجى تأكيد هوية الموظف أولاً.')
      return
    }

    if (!isInRange) {
      alert('لا يمكنك تسجيل البصمة لأنك خارج نطاق موقع العمل!')
      return
    }

    await executePunch({
      method: 'gps',
      token: null,
      locationId: location?.id,
    })
  }

  // الدالة العامة لتسجيل البصمة
  const executePunch = async ({ method, token, locationId }) => {
    try {
      setSubmitting(true)
      setPunchResult(null)

      const response = await submitCheckIn({
        employee_code: verifiedEmployee.employee_code,
        device_id: deviceId,
        device_info: deviceSummary,
        token: token || null,
        location_id: locationId || location?.id,
        lat: userCoords?.lat || null,
        lng: userCoords?.lng || null,
        accuracy: userCoords?.accuracy || null,
        method,
      })

      if (response.success) {
        if (navigator.vibrate) navigator.vibrate([100, 50, 100])
        setPunchResult({
          status: 'success',
          type: response.type,
          method: response.method,
          title: response.type === 'in' ? 'تم تسجيل الحضور بنجاح' : 'تم تسجيل الانصراف بنجاح',
          message: response.message,
          employee_name: response.employee_name,
          time: new Date().toLocaleTimeString('ar-EG-u-ca-gregory', {
            calendar: 'gregory',
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

  const formattedTime = currentTime.toLocaleTimeString('ar-EG-u-ca-gregory', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })

  const formattedDate = currentTime.toLocaleDateString('ar-EG-u-ca-gregory', {
    calendar: 'gregory',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-between py-6 px-4 sm:px-6 selection:bg-blue-600 selection:text-white">
      <div className="max-w-md w-full mx-auto space-y-4">
        
        {/* الترويسة الرئيسية والشعار الأنيق */}
        <header className="text-center pt-1 pb-1">
          <div className="relative inline-block">
            <img
              src="/logo.png"
              alt="PunchLog Logo"
              className="w-20 h-20 mx-auto mb-2 rounded-2xl shadow-md object-contain border border-slate-100"
            />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">PunchLog</h1>
          <p className="text-xs font-semibold text-slate-500">نظام بصمة الحضور والانصراف الذكي</p>

          {/* شريط الساعة اللحظية واليوم */}
          <div className="inline-flex items-center gap-2 mt-2 px-3.5 py-1 rounded-full bg-white border border-slate-200/80 shadow-xs text-xs font-mono text-slate-700">
            <Calendar className="w-3.5 h-3.5 text-blue-600" />
            <span className="font-semibold">{formattedDate}</span>
            <span className="text-slate-300">|</span>
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            <span className="font-bold text-blue-700">{formattedTime}</span>
          </div>
        </header>

        {/* ======================================================== */}
        {/* 1. قسم إدخال الرقم والتحقق (تصميم متناسق تماماً للجوال) */}
        {/* ======================================================== */}
        {!verifiedEmployee ? (
          <form
            onSubmit={handleVerifyEmployee}
            className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-md shadow-slate-200/50 space-y-4"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <User className="w-4 h-4 text-blue-600" />
                  الرقم التعريفي للموظف
                </label>
                <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-lg">
                  (4 أرقام)
                </span>
              </div>

              {/* حقل الرقم التعريفي - كبير ومريح للمس */}
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={employeeCode}
                  onChange={(e) => {
                    const clean = e.target.value.replace(/\D/g, '').slice(0, 4)
                    setEmployeeCode(clean)
                    setVerifyError('')
                  }}
                  placeholder="1001"
                  required
                  autoFocus
                  className="w-full bg-slate-50 border-2 border-slate-200 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/10 rounded-2xl py-3.5 text-2xl font-mono text-center font-extrabold tracking-widest text-slate-900 placeholder-slate-300 transition outline-none"
                />

                {employeeCode && (
                  <button
                    type="button"
                    onClick={() => setEmployeeCode('')}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* زر تأكيد الهوية كامل العرض - لا ينكسر أو يخرج عن الإطار أبداً */}
              <button
                type="submit"
                disabled={verifying || !employeeCode.trim()}
                className="w-full mt-3 py-3.5 px-5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-2xl text-sm flex items-center justify-center gap-2 shadow-md shadow-blue-500/25 transition active:scale-[0.98] cursor-pointer"
              >
                {verifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>جاري التحقق من الرقم...</span>
                  </>
                ) : (
                  <>
                    <span>تأكيد الهوية</span>
                    <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                  </>
                )}
              </button>
            </div>

            {verifyError && (
              <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{verifyError}</span>
              </div>
            )}

            {/* معرّف ونوع الجهاز المسجل */}
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5 font-medium">
                <Smartphone className="w-3.5 h-3.5 text-blue-600" />
                <span>{deviceSummary}:</span>
              </span>
              <span className="font-mono text-[10px] text-slate-700 font-bold bg-white px-2 py-0.5 rounded border border-slate-200">
                {deviceId.slice(0, 8)}...{deviceId.slice(-4)}
              </span>
            </div>
          </form>
        ) : (
          /* ======================================================== */
          /* بطاقة الموظف المعتمد (تصميم فخم وعصري) */
          /* ======================================================== */
          <div className="bg-white border border-blue-200/80 rounded-3xl p-5 shadow-md shadow-blue-500/5 relative overflow-hidden animate-in fade-in">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center font-black text-xl shadow-md shadow-blue-500/20">
                  {verifiedEmployee.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      تم التحقق
                    </span>
                    <span className="text-xs font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md font-bold">
                      #{verifiedEmployee.employee_code}
                    </span>
                  </div>
                  <h2 className="text-lg font-black text-slate-900 mt-1 leading-tight">
                    {verifiedEmployee.name}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5 font-semibold">
                    {verifiedEmployee.department}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleResetEmployee}
                className="text-[11px] font-bold text-slate-600 hover:text-rose-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-3 py-1.5 rounded-xl transition cursor-pointer"
                title="تغيير الموظف"
              >
                تغيير
              </button>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* 2. اختيار طريقة البصمة (مسح الباركود أو بصمة الموقع) */}
        {/* ======================================================== */}
        {verifiedEmployee && (
          <div className="space-y-3.5 animate-in fade-in">
            {/* شريط التبديل بين الطريقتين */}
            <div className="grid grid-cols-2 gap-2 bg-slate-200/80 p-1.5 rounded-2xl border border-slate-200">
              <button
                type="button"
                onClick={() => setPunchMethod('qr')}
                className={`py-3 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                  punchMethod === 'qr'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Camera className="w-4 h-4" />
                <span>مسح الباركود (QR)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPunchMethod('gps')
                  if (gpsStatus === 'idle') requestLocation()
                }}
                className={`py-3 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                  punchMethod === 'gps'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Compass className="w-4 h-4" />
                <span>بصمة الموقع (GPS)</span>
              </button>
            </div>

            {/* ---------------------------------------------------- */}
            {/* أ) شاشة طريقة مسح الباركود (الكاميرا مفعلة بالكامل) */}
            {/* ---------------------------------------------------- */}
            {punchMethod === 'qr' && (
              <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-sm space-y-4 text-center">
                <button
                  type="button"
                  onClick={startScanner}
                  disabled={submitting}
                  className="w-full py-4 px-6 rounded-2xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/25 transition flex items-center justify-center gap-2.5 cursor-pointer active:scale-[0.98]"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>جاري المعالجة...</span>
                    </>
                  ) : (
                    <>
                      <Camera className="w-5 h-5" />
                      <span>فتح الكاميرا ومسح باركود الشاشة</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* ب) شاشة طريقة بصمة الموقع الجغرافي */}
            {/* ---------------------------------------------------- */}
            {punchMethod === 'gps' && (
              <div className="bg-white border border-slate-200/90 rounded-3xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-bold text-slate-800">
                      {location ? location.name : 'موقع العمل'}
                    </span>
                  </div>

                  <button
                    onClick={requestLocation}
                    disabled={gpsStatus === 'locating'}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-xl transition cursor-pointer"
                  >
                    <Navigation className={`w-3 h-3 ${gpsStatus === 'locating' ? 'animate-spin' : ''}`} />
                    <span>{gpsStatus === 'granted' ? 'تحديث الموقع' : 'تحديد موقعي (GPS)'}</span>
                  </button>
                </div>

                {/* حالة الموقع */}
                {gpsStatus === 'idle' && (
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-slate-500 text-xs text-center font-medium">
                    اضغط على "تحديد موقعي" للتأكد من تواجدك داخل نطاق المقر قبل البصمة.
                  </div>
                )}

                {gpsStatus === 'locating' && (
                  <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-700 text-xs flex items-center justify-center gap-2 font-semibold">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span>جاري تحديد موقعك الجغرافي بالأقمار الصناعية...</span>
                  </div>
                )}

                {gpsStatus === 'denied' && (
                  <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <span>{gpsError}</span>
                  </div>
                )}

                {location && gpsStatus === 'granted' && (
                  <div className="space-y-2">
                    <div
                      className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs font-bold ${
                        isInRange
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-amber-50 border-amber-200 text-amber-800'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isInRange ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                        )}
                        <span>
                          {isInRange
                            ? `أنت داخل نطاق العمل (${distanceToWork ?? 0} متراً من المقر)`
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

                {/* زر البصمة عبر الموقع */}
                <button
                  type="button"
                  onClick={handleGpsPunch}
                  disabled={!isInRange || submitting}
                  className={`w-full py-4 px-6 rounded-2xl font-bold text-sm shadow-md transition flex items-center justify-center gap-2.5 cursor-pointer ${
                    isInRange && !submitting
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/25 active:scale-[0.98]'
                      : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-75'
                  }`}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>جاري تسجيل البصمة...</span>
                    </>
                  ) : (
                    <>
                      <Compass className="w-5 h-5" />
                      <span>تسجيل البصمة عبر الموقع (GPS)</span>
                    </>
                  )}
                </button>

                {!isInRange && gpsStatus === 'granted' && (
                  <p className="text-[11px] text-amber-600 text-center font-semibold">
                    * يجب أن تتواجد داخل دائرة المقر لتسجيل البصمة الجغرافية.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* 3. بطاقة عرض النتيجة (نجاح / تنبيه / خطأ) */}
        {/* ======================================================== */}
        {punchResult && (
          <div
            className={`p-5 rounded-3xl border shadow-sm transition-all animate-in fade-in ${
              punchResult.status === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : punchResult.status === 'pending'
                ? 'bg-amber-50 border-amber-200 text-amber-950'
                : 'bg-red-50 border-red-200 text-red-950'
            }`}
          >
            <div className="flex items-start gap-3">
              {punchResult.status === 'success' && (
                <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-2xl border border-emerald-200">
                  {punchResult.type === 'in' ? (
                    <ArrowDownRight className="w-6 h-6" />
                  ) : (
                    <ArrowUpLeft className="w-6 h-6" />
                  )}
                </div>
              )}
              {punchResult.status === 'pending' && (
                <div className="p-2.5 bg-amber-100 text-amber-700 rounded-2xl border border-amber-200">
                  <Smartphone className="w-6 h-6" />
                </div>
              )}
              {punchResult.status === 'error' && (
                <div className="p-2.5 bg-red-100 text-red-700 rounded-2xl border border-red-200">
                  <AlertCircle className="w-6 h-6" />
                </div>
              )}

              <div className="flex-1">
                <h3 className="font-bold text-base leading-tight mb-1 text-slate-900">
                  {punchResult.title}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed font-semibold">
                  {punchResult.message}
                </p>

                {punchResult.time && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 font-mono font-bold">
                    <Clock className="w-3.5 h-3.5" />
                    <span>الوقت المعتمد: {punchResult.time}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* نافذة الكاميرا والماسح المنبثقة (كامل الشاشة وبدون أي مربع داخلي) */}
      {/* ======================================================== */}
      {isScanning && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col items-center justify-between p-4 sm:p-6 select-none animate-in fade-in">
          {/* الشريط العلوي للماسح */}
          <div className="w-full max-w-md flex justify-between items-center text-white z-10 pt-2">
            <div className="flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-full border border-slate-700">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-xs font-bold">الكاميرا نشطة - امسح الباركود</span>
            </div>
            <button
              onClick={stopScanner}
              className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition cursor-pointer"
              title="إغلاق الكاميرا"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* الكاميرا مفعلة بالكامل على كامل مساحة الإطار بدون أي مربع داخلي */}
          <div className="w-full max-w-md relative overflow-hidden rounded-3xl bg-black border-2 border-blue-500/40 shadow-2xl flex-1 my-4 flex items-center justify-center">
            <div id="qr-reader" className="w-full h-full" />
            {/* خط ليزر متحرك عبر الكاميرا بالكامل */}
            <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-lg shadow-blue-400/80 animate-scan-beam pointer-events-none" />
          </div>

          {/* الشريط السفلي */}
          <div className="w-full max-w-md text-center text-slate-300 text-xs pb-2">
            مسح البصمة للموظف: <strong className="text-white text-sm font-bold">{verifiedEmployee?.name}</strong>
          </div>
        </div>
      )}

      {/* التذييل مع مسافة أمان لزر Netlify السفلي */}
      <footer className="text-center pt-6 pb-20 text-[11px] text-slate-500">
        <a href="/admin" className="text-slate-500 hover:text-blue-600 font-bold transition underline underline-offset-4">
          بوابة الإدارة والمشرفين &larr;
        </a>
      </footer>
    </div>
  )
}

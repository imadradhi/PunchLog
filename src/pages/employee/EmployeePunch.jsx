import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { Html5Qrcode } from 'html5-qrcode'
import { 
  QrCode, Smartphone, MapPin, User, CheckCircle2, 
  AlertCircle, Camera, RefreshCw, X, ShieldCheck, 
  ArrowDownRight, ArrowUpLeft, Loader2, Navigation, Clock, Search, ArrowRight, Compass 
} from 'lucide-react'
import { getOrCreateDeviceId, calculateDistance, formatArabicDateTime } from '../../lib/utils'
import { submitCheckIn } from '../../lib/checkInService'

export default function EmployeePunch() {
  const deviceId = getOrCreateDeviceId()

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
        setVerifyError(`الرقم (${cleanCode}) غير مسجل في النظام. يرجى مراجعة الإدارة.`)
        return
      }

      if (!data.is_active) {
        setVerifiedEmployee(null)
        setVerifyError(`حساب الموظف (${data.name}) موقوف حالياً.`)
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
  // تنفيذ البصمة عبر مسح الباركود (QR Code) - لا تتطلب فحص موقع
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

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
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
  // تنفيذ البصمة عبر الموقع الجغرافي (GPS) - تتطلب التواجد داخل الدائرة
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
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-between p-4 sm:p-6 selection:bg-blue-600 selection:text-white">
      <div className="max-w-md w-full mx-auto space-y-4">
        {/* الترويسة وشعار التطبيق الجديد */}
        <header className="text-center pt-2">
          <img
            src="/logo.png"
            alt="PunchLog Logo"
            className="w-20 h-20 mx-auto mb-2.5 rounded-2xl shadow-sm object-contain"
          />
          <h1 className="text-2xl font-black tracking-tight text-slate-800">PunchLog</h1>
          <p className="text-xs font-semibold text-slate-500">بصمة الحضور والانصراف الذكية</p>
        </header>

        {/* ======================================================== */}
        {/* 1. قسم الرقم الوظيفي والتحقق من هوية واسم الموظف */}
        {/* ======================================================== */}
        {!verifiedEmployee ? (
          <form
            onSubmit={handleVerifyEmployee}
            className="bg-white border border-slate-200/90 rounded-3xl p-5 shadow-sm space-y-3.5"
          >
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <User className="w-4 h-4 text-blue-600" />
                  أدخل رقمك التعريفي (4 أرقام)
                </span>
                <span className="text-[10px] text-slate-400 font-mono">مثال: 1001، 1002</span>
              </label>

              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={employeeCode}
                  onChange={(e) => {
                    setEmployeeCode(e.target.value.trim())
                    setVerifyError('')
                  }}
                  placeholder="1001"
                  required
                  autoFocus
                  className="flex-1 bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 rounded-2xl px-4 py-3 text-xl font-mono text-center font-bold tracking-widest text-slate-900 placeholder-slate-400 transition outline-none"
                />

                <button
                  type="submit"
                  disabled={verifying || !employeeCode.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-5 py-3 rounded-2xl text-xs flex items-center justify-center gap-1.5 shadow-md shadow-blue-500/20 transition cursor-pointer"
                >
                  {verifying ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>تأكيد الهوية</span>
                      <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
                    </>
                  )}
                </button>
              </div>
            </div>

            {verifyError && (
              <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span>{verifyError}</span>
              </div>
            )}

            {/* معرّف الجهاز */}
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-blue-600" />
                معرّف هذا الهاتف:
              </span>
              <span className="font-mono text-[10px] text-slate-600 select-all font-semibold">
                {deviceId.slice(0, 8)}...{deviceId.slice(-4)}
              </span>
            </div>
          </form>
        ) : (
          /* بطاقة الموظف بعد التحقق */
          <div className="bg-white border border-blue-200 rounded-3xl p-4 shadow-sm relative overflow-hidden animate-in fade-in">
            <div className="flex items-start justify-between gap-3 relative z-10">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center font-bold text-lg shadow-xs">
                  {verifiedEmployee.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                      تم التحقق
                    </span>
                    <span className="text-xs font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md font-semibold">
                      #{verifiedEmployee.employee_code}
                    </span>
                  </div>
                  <h2 className="text-base font-bold text-slate-900 mt-1 leading-tight">
                    {verifiedEmployee.name}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">
                    {verifiedEmployee.department}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleResetEmployee}
                className="text-[11px] font-semibold text-slate-600 hover:text-rose-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-2.5 py-1.5 rounded-xl transition cursor-pointer"
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
          <div className="space-y-4 animate-in fade-in">
            {/* شريط التبديل بين الطريقتين */}
            <div className="grid grid-cols-2 gap-2 bg-slate-200/70 p-1.5 rounded-2xl border border-slate-200">
              <button
                type="button"
                onClick={() => setPunchMethod('qr')}
                className={`py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                  punchMethod === 'qr'
                    ? 'bg-blue-600 text-white shadow-sm'
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
                className={`py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                  punchMethod === 'gps'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Compass className="w-4 h-4" />
                <span>بصمة الموقع (GPS)</span>
              </button>
            </div>

            {/* ---------------------------------------------------- */}
            {/* أ) شاشة طريقة مسح الباركود (لا تتطلب فحص موقع) */}
            {/* ---------------------------------------------------- */}
            {punchMethod === 'qr' && (
              <div className="bg-white border border-slate-200/90 rounded-3xl p-5 shadow-sm space-y-4 text-center">
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl text-xs text-blue-800 leading-relaxed text-right">
                  <strong>💡 ميزة مسح الباركود:</strong> لا تتطلب فحص الموقع الجغرافي؛ لأن الرمز يتجدد كل 10 ثوانٍ ولا يوجد إلا على شاشة الاستقبال داخل المقر.
                </div>

                <button
                  type="button"
                  onClick={startScanner}
                  disabled={submitting}
                  className="w-full py-4 px-6 rounded-2xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition flex items-center justify-center gap-2.5 cursor-pointer active:scale-[0.98]"
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
            {/* ب) شاشة طريقة بصمة الموقع الجغرافي (تتطلب التواجد بالدائرة) */}
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
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 rounded-xl transition cursor-pointer"
                  >
                    <Navigation className={`w-3 h-3 ${gpsStatus === 'locating' ? 'animate-spin' : ''}`} />
                    <span>{gpsStatus === 'granted' ? 'تحديث الموقع' : 'تحديد موقعي (GPS)'}</span>
                  </button>
                </div>

                {/* حالة الموقع */}
                {gpsStatus === 'idle' && (
                  <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-500 text-xs text-center">
                    اضغط على "تحديد موقعي" للتأكد من تواجدك داخل نطاق المقر قبل البصمة.
                  </div>
                )}

                {gpsStatus === 'locating' && (
                  <div className="p-3 rounded-2xl bg-blue-50 border border-blue-200 text-blue-700 text-xs flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span>جاري تحديد موقعك الجغرافي بالأقمار الصناعية...</span>
                  </div>
                )}

                {gpsStatus === 'denied' && (
                  <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <span>{gpsError}</span>
                  </div>
                )}

                {location && gpsStatus === 'granted' && (
                  <div className="space-y-2">
                    <div
                      className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs font-semibold ${
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
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20 active:scale-[0.98]'
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
                  <p className="text-[11px] text-amber-600 text-center font-medium">
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
                <p className="text-xs text-slate-600 leading-relaxed font-medium">
                  {punchResult.message}
                </p>

                {punchResult.time && (
                  <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-700 font-mono font-bold">
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
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl p-5 shadow-2xl relative">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-800">وجه الكاميرا نحو باركود الشاشة</span>
              </div>
              <button
                onClick={stopScanner}
                className="p-1.5 rounded-full bg-slate-100 text-slate-500 hover:text-slate-900 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl bg-black aspect-square relative border-2 border-dashed border-blue-400">
              <div id="qr-reader" className="w-full h-full" />
            </div>

            <p className="text-[11px] text-slate-500 text-center mt-3 font-medium">
              مسح البصمة للموظف: <strong className="text-slate-800 font-bold">{verifiedEmployee?.name}</strong>
            </p>
          </div>
        </div>
      )}

      {/* التذييل */}
      <footer className="text-center pt-4 pb-2 text-[11px] text-slate-500">
        <a href="/admin" className="text-slate-500 hover:text-blue-600 font-semibold transition underline underline-offset-4">
          بوابة الإدارة والمشرفين &larr;
        </a>
      </footer>
    </div>
  )
}

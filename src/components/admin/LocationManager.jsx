import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { MapPin, Save, Crosshair, AlertCircle, CheckCircle2, Loader2, Navigation } from 'lucide-react'
import L from 'leaflet'

// إصلاح روابط الأيقونات الافتراضية في Leaflet
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

export default function LocationManager() {
  const [locationId, setLocationId] = useState(null)
  const [name, setName] = useState('المقر الرئيسي')
  const [lat, setLat] = useState(24.7136) // الرياض كافتراضي
  const [lng, setLng] = useState(46.6753)
  const [radiusM, setRadiusM] = useState(100)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [locatingCurrent, setLocatingCurrent] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markerRef = useRef(null)
  const circleRef = useRef(null)

  // جلب موقع العمل المحفوظ
  useEffect(() => {
    async function fetchLocation() {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('locations')
          .select('*')
          .order('created_at', { ascending: true })
          .limit(1)

        if (error) throw error

        if (data && data.length > 0) {
          const loc = data[0]
          setLocationId(loc.id)
          setName(loc.name)
          setLat(loc.lat)
          setLng(loc.lng)
          setRadiusM(loc.radius_m)
        }
      } catch (err) {
        console.error('Error fetching location:', err)
        setErrorMsg('تعذر تحميل بيانات الموقع. تأكد من إعداد قاعدة البيانات.')
      } finally {
        setLoading(false)
      }
    }

    fetchLocation()
  }, [])

  // تهيئة وتحديث خريطة Leaflet
  useEffect(() => {
    if (loading || !mapContainerRef.current) return

    // إنشاء الخريطة عند أول تحميل
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current).setView([lat, lng], 16)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)

      // ماركر الموقع
      const marker = L.marker([lat, lng], { draggable: true }).addTo(map)
      // دائرة نصف قطر السماح
      const circle = L.circle([lat, lng], {
        radius: radiusM,
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.25,
        weight: 2,
      }).addTo(map)

      // النقر على الخريطة لتغيير الموقع
      map.on('click', (e) => {
        const { lat: newLat, lng: newLng } = e.latlng
        setLat(Number(newLat.toFixed(6)))
        setLng(Number(newLng.toFixed(6)))
      })

      // سحب الماركر
      marker.on('dragend', () => {
        const pos = marker.getLatLng()
        setLat(Number(pos.lat.toFixed(6)))
        setLng(Number(pos.lng.toFixed(6)))
      })

      mapInstanceRef.current = map
      markerRef.current = marker
      circleRef.current = circle
    } else {
      // تحديث الماركر والدائرة عند تغير الإحداثيات
      markerRef.current.setLatLng([lat, lng])
      circleRef.current.setLatLng([lat, lng])
      circleRef.current.setRadius(radiusM)
      mapInstanceRef.current.panTo([lat, lng])
    }

    // تنظيف الخريطة عند تفكيك المكون
    return () => {
      // لا ندمر الخريطة في كل render، نحافظ على النسخة
    }
  }, [loading, lat, lng, radiusM])

  // استخدام إحداثيات GPS الحالية لمتصفح المدير
  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('المتصفح لا يدعم تحديد الموقع الجغرافي GPS.')
      return
    }

    setLocatingCurrent(true)
    setErrorMsg('')

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const currentLat = Number(pos.coords.latitude.toFixed(6))
        const currentLng = Number(pos.coords.longitude.toFixed(6))
        setLat(currentLat)
        setLng(currentLng)
        if (mapInstanceRef.current) {
          mapInstanceRef.current.flyTo([currentLat, currentLng], 17)
        }
        setLocatingCurrent(false)
        setSuccessMsg('تم جلب إحداثيات موقعك الحالي بنجاح.')
      },
      (err) => {
        setLocatingCurrent(false)
        setErrorMsg('تعذر الوصول إلى GPS. تأكد من تفعيل إذن الوصول للموقع في المتصفح.')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // حفظ الموقع في Supabase
  const handleSave = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    if (!name.trim()) {
      setErrorMsg('يرجى إدخال اسم لموقع العمل.')
      return
    }

    try {
      setSaving(true)
      if (locationId) {
        const { error } = await supabase
          .from('locations')
          .update({
            name: name.trim(),
            lat,
            lng,
            radius_m: radiusM,
          })
          .eq('id', locationId)

        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from('locations')
          .insert([
            {
              name: name.trim(),
              lat,
              lng,
              radius_m: radiusM,
            },
          ])
          .select()

        if (error) throw error
        if (data && data[0]) setLocationId(data[0].id)
      }

      setSuccessMsg('تم حفظ وتحديث إحداثيات ونطاق موقع العمل بنجاح.')
    } catch (err) {
      setErrorMsg(err.message || 'حدث خطأ أثناء حفظ الموقع.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* رأس الصفحة */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600" />
            نطاق وموقع العمل الجغرافي (Geofencing)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            حدد موقع المنشأة ونصف القطر المسموح به للموظف بتسجيل الحضور (بالأمتار)
          </p>
        </div>

        <button
          type="button"
          onClick={handleGetCurrentLocation}
          disabled={locatingCurrent}
          className="inline-flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer"
        >
          {locatingCurrent ? (
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
          ) : (
            <Navigation className="w-4 h-4 text-blue-600" />
          )}
          <span>استخدام موقعي الحالي (GPS)</span>
        </button>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* الخريطة التفاعلية */}
        <div className="lg:col-span-2 bg-white p-3 rounded-2xl shadow-sm border border-slate-200">
          <div className="relative rounded-xl overflow-hidden h-[420px] bg-slate-100 border border-slate-200">
            {loading && (
              <div className="absolute inset-0 z-20 bg-white/70 backdrop-blur-xs flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            )}
            <div ref={mapContainerRef} className="w-full h-full z-10" />
          </div>
          <p className="text-[11px] text-slate-400 mt-2 px-1 text-center">
            * يمكنك النقر على أي مكان بالخريطة أو سحب الدبوس لتحديد نقطة ارتكاز المقر. الدائرة الزرقاء تمثل النطاق المسموح.
          </p>
        </div>

        {/* نموذج الإعدادات والتحكم */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                اسم الموقع / الفرع
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: المقر الرئيسي - الرياض"
                required
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  خط العرض (Latitude)
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={lat}
                  onChange={(e) => setLat(parseFloat(e.target.value) || 0)}
                  required
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  خط الطول (Longitude)
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={lng}
                  onChange={(e) => setLng(parseFloat(e.target.value) || 0)}
                  required
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  نصف قطر النطاق المسموح
                </label>
                <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  {radiusM} متر
                </span>
              </div>
              <input
                type="range"
                min="20"
                max="500"
                step="5"
                value={radiusM}
                onChange={(e) => setRadiusM(parseInt(e.target.value))}
                className="w-full accent-blue-600 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                <span>20 م</span>
                <span>100 م</span>
                <span>250 م</span>
                <span>500 م</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-100 text-blue-900 text-xs leading-relaxed">
              <strong>قاعدة التحقق:</strong> لن يُسمح لأي موظف بتسجيل الحضور أو الانصراف إذا كان يبعد أكثر من{' '}
              <span className="font-bold">{radiusM} متراً</span> عن هذه النقطة بدقة GPS عالية.
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-xl shadow-sm transition flex items-center justify-center gap-2 text-sm cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري الحفظ...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>حفظ إعدادات الموقع</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}


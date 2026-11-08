/**
 * حساب المسافة بين نقطتين جغرافيتين بالمتر باستخدام معادلة Haversine
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3 // نصف قطر الأرض بالمتر
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return Math.round(R * c) // المسافة بالمتر
}

const STORAGE_KEY = 'punchlog_device_id'
const DB_NAME = 'PunchLogDeviceStore'
const STORE_NAME = 'device_metadata'

/**
 * أدوات مساعدة للكوكيز (Cookies)
 */
function getCookie(name) {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'))
  return match ? decodeURIComponent(match[3]) : null
}

function setCookie(name, value, days = 3650) {
  if (typeof document === 'undefined') return
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

/**
 * فتح وتجهيز قاعدة بيانات IndexedDB
 */
function openDeviceDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/**
 * قراءة معرّف الجهاز من IndexedDB
 */
async function getIndexedDBDeviceId() {
  const db = await openDeviceDB()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(STORAGE_KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/**
 * حفظ معرّف الجهاز في IndexedDB
 */
async function setIndexedDBDeviceId(id) {
  const db = await openDeviceDB()
  if (!db) return
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(id, STORAGE_KEY)
  } catch {}
}

/**
 * توليد UUID v4 عشوائي مطابق للمواصفات
 */
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * الحصول على معرّف الجهاز بشكل متزامن أولي (مع قراءة الكوكيز و localStorage)
 */
export function getOrCreateDeviceId() {
  let deviceId = null

  // 1. محاولة القراءة من localStorage
  try {
    deviceId = localStorage.getItem(STORAGE_KEY)
  } catch {}

  // 2. إذا لم يوجد في localStorage، استرجاعه من Cookie
  if (!deviceId) {
    deviceId = getCookie(STORAGE_KEY)
  }

  // 3. إذا لم يوجد في أي منهما، توليد معرف جديد مؤقت وسيتم التحقق من IndexedDB أيضاً
  if (!deviceId) {
    deviceId = generateUUID()
  }

  // مزامنة فورية إلى localStorage و Cookie
  try {
    localStorage.setItem(STORAGE_KEY, deviceId)
  } catch {}
  setCookie(STORAGE_KEY, deviceId)

  // حفظ في IndexedDB في الخلفية
  setIndexedDBDeviceId(deviceId)

  return deviceId
}

/**
 * مزامنة واسترجاع معرّف الجهاز المتين (يشمل IndexedDB + Cookie + localStorage)
 * يستعيد المعرف من أي مستودع لا يزال محتفظاً به حتى لو حُذف الآخران!
 */
export async function getOrSyncDeviceId() {
  let localId = null
  let cookieId = null
  let idbId = null

  try {
    localId = localStorage.getItem(STORAGE_KEY)
  } catch {}

  cookieId = getCookie(STORAGE_KEY)
  idbId = await getIndexedDBDeviceId()

  // تحديد المعرّف الموثوق الموجود في أي من المصادر الثلاثة
  const definitiveId = localId || cookieId || idbId || generateUUID()

  // مزامنة المعرف عبر كافة المستودعات الثلاثة لضمان بقائه ثابتاً ومقاوماً للحذف
  try {
    localStorage.setItem(STORAGE_KEY, definitiveId)
  } catch {}
  setCookie(STORAGE_KEY, definitiveId)
  await setIndexedDBDeviceId(definitiveId)

  return definitiveId
}

/**
 * استخراج نوع الجهاز والمتصفح ونظام التشغيل بدقة
 */
export function getDeviceSummary() {
  if (typeof navigator === 'undefined') return 'جهاز غير معروف'
  const ua = navigator.userAgent || ''
  
  let os = 'جهاز غير معروف'
  if (/iPhone|iPod/i.test(ua)) os = 'iPhone'
  else if (/iPad/i.test(ua)) os = 'iPad'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/Windows/i.test(ua)) os = 'Windows PC'
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'Mac'
  else if (/Linux/i.test(ua)) os = 'Linux'

  let browser = 'متصفح'
  if (/Edg/i.test(ua)) browser = 'Edge'
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet'
  else if (/Chrome|CriOS/i.test(ua)) browser = 'Chrome'
  else if (/Safari/i.test(ua) && !/Chrome|CriOS/i.test(ua)) browser = 'Safari'
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'Firefox'
  else if (/Opera|OPR/i.test(ua)) browser = 'Opera'

  return `${os} (${browser})`
}

/**
 * تنسيق التاريخ والوقت بالعربية بالتقويم الميلادي حصراً
 */
export function formatArabicDateTime(dateString) {
  if (!dateString) return '-'
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('ar-EG-u-ca-gregory', {
    calendar: 'gregory',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date)
}

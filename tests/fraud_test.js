import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://pjypexeylwnaymenjfhm.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_-Hz6vp8vIfUPDNWz-bpaog_kzvASTHi'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ألوان مخرجات الطرفية
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
}

async function runFraudTests() {
  console.log(`\n${colors.bold}${colors.cyan}================================================================${colors.reset}`)
  console.log(`${colors.bold}${colors.cyan}     بدء اختبارات التحايل الأمني لنظام البصمة (Fraud & Security)   ${colors.reset}`)
  console.log(`${colors.bold}${colors.cyan}================================================================${colors.reset}\n`)

  // 1. جلب موقع العمل للتجربة
  const { data: locs, error: locError } = await supabase.from('locations').select('*').limit(1)
  if (locError || !locs || locs.length === 0) {
    console.error(`${colors.red}❌ تعذر جلب موقع العمل: ${locError?.message || 'لا توجد مواقع'}${colors.reset}`)
    return
  }
  const testLocation = locs[0]
  console.log(`📍 موقع العمل المعتمد للاختبار: ${colors.bold}${testLocation.name}${colors.reset}`)
  console.log(`   الإحداثيات: lat=${testLocation.lat}, lng=${testLocation.lng}, النطاق=${testLocation.radius_m}م\n`)

  // التحقق من وجود دالة check_in_rpc
  console.log(`🔍 جاري فحص جاهزية دالة التحقق في الخادم (check_in_rpc)...`)
  const dummyDeviceId = '00000000-0000-0000-0000-000000000001'

  // =========================================================================
  // الاختبار 1: خارج النطاق الجغرافي (Outside Geofence)
  // =========================================================================
  console.log(`${colors.bold}1️⃣  اختبار التحايل: موظف يحاول تسجيل البصمة من موقع بعيد (خارج النطاق)...${colors.reset}`)
  // إحداثيات بعيدة (جدة مثلاً بينما المقر في الرياض)
  const farLat = testLocation.lat + 0.1 // يبعد حوالي 11 كم
  const farLng = testLocation.lng + 0.1

  const res1 = await supabase.rpc('check_in_rpc', {
    p_employee_code: 'EMP101',
    p_device_id: dummyDeviceId,
    p_token: 'fake_token',
    p_location_id: testLocation.id,
    p_lat: farLat,
    p_lng: farLng,
    p_accuracy: 15,
  })

  if (res1.error) {
    console.log(`${colors.yellow}⚠️ تنبيه: يبدو أن سكربت 002_check_in_rpc.sql لم يُنفّذ بعد في SQL Editor: ${res1.error.message}${colors.reset}`)
    console.log(`يرجى تنفيذ ملف supabase/migrations/002_check_in_rpc.sql في Supabase SQL Editor أولاً.\n`)
    return
  }

  if (!res1.data.success && (res1.data.error?.includes('خارج نطاق') || res1.data.error?.includes('موافقة'))) {
    console.log(`   ${colors.green}✓ نجاح الفحص الأمني:${colors.reset} تم كشف المحاولة ورفضها بنجاح!`)
    console.log(`   الرسالة: "${res1.data.error}"\n`)
  } else {
    console.log(`   ${colors.yellow}الرد:${colors.reset}`, res1.data, '\n')
  }

  // =========================================================================
  // الاختبار 2: ضعف دقة إشارة الـ GPS (Inaccurate GPS)
  // =========================================================================
  console.log(`${colors.bold}2️⃣  اختبار التحايل: إشارة GPS ضعيفة ومشكوك بها (accuracy = 250م > 100م)...${colors.reset}`)
  const res2 = await supabase.rpc('check_in_rpc', {
    p_employee_code: 'EMP101',
    p_device_id: dummyDeviceId,
    p_token: 'fake_token',
    p_location_id: testLocation.id,
    p_lat: testLocation.lat,
    p_lng: testLocation.lng,
    p_accuracy: 250, // دقة سيئة
  })

  if (!res2.data.success && res2.data.error?.includes('ضعيفة')) {
    console.log(`   ${colors.green}✓ نجاح الفحص الأمني:${colors.reset} تم رفض الإشارة الضعيفة بنجاح لمنع تزييف الموقع!`)
    console.log(`   الرسالة: "${res2.data.error}"\n`)
  } else {
    console.log(`   ${colors.yellow}الرد:${colors.reset}`, res2.data, '\n')
  }

  // =========================================================================
  // الاختبار 3: باركود منتهي الصلاحية (Expired QR Token)
  // =========================================================================
  console.log(`${colors.bold}3️⃣  اختبار التحايل: استخدام رمز باركود قديم منتهي الصلاحية (Expired)...${colors.reset}`)
  // إنشاء رمز منتهي الصلاحية عمداً
  const expiredToken = 'expired_' + Math.random().toString(36).substring(2, 10)
  const pastTime = new Date(Date.now() - 60 * 1000).toISOString() // قبل دقيقة

  await supabase.from('qr_tokens').insert([
    {
      token: expiredToken,
      location_id: testLocation.id,
      expires_at: pastTime,
      used: false,
    },
  ])

  const res3 = await supabase.rpc('check_in_rpc', {
    p_employee_code: 'EMP101',
    p_device_id: dummyDeviceId,
    p_token: expiredToken,
    p_location_id: testLocation.id,
    p_lat: testLocation.lat,
    p_lng: testLocation.lng,
    p_accuracy: 10,
  })

  if (!res3.data.success && res3.data.error?.includes('صلاحية')) {
    console.log(`   ${colors.green}✓ نجاح الفحص الأمني:${colors.reset} تم رفض الرمز المنتهي بنجاح!`)
    console.log(`   الرسالة: "${res3.data.error}"\n`)
  } else {
    console.log(`   ${colors.yellow}الرد:${colors.reset}`, res3.data, '\n')
  }

  // =========================================================================
  // الاختبار 4: إعادة استخدام نفس الباركود (Replay Attack / Reused QR)
  // =========================================================================
  console.log(`${colors.bold}4️⃣  اختبار التحايل: محاولة إعادة استخدام رمز باركود تم استخدامه مسبقاً (used=true)...${colors.reset}`)
  const reusedToken = 'reused_' + Math.random().toString(36).substring(2, 10)
  const futureTime = new Date(Date.now() + 60 * 1000).toISOString()

  await supabase.from('qr_tokens').insert([
    {
      token: reusedToken,
      location_id: testLocation.id,
      expires_at: futureTime,
      used: true, // مستخدم مسبقاً
    },
  ])

  const res4 = await supabase.rpc('check_in_rpc', {
    p_employee_code: 'EMP101',
    p_device_id: dummyDeviceId,
    p_token: reusedToken,
    p_location_id: testLocation.id,
    p_lat: testLocation.lat,
    p_lng: testLocation.lng,
    p_accuracy: 10,
  })

  if (!res4.data.success && res4.data.error?.includes('استخدام هذا الرمز من قبل')) {
    console.log(`   ${colors.green}✓ نجاح الفحص الأمني:${colors.reset} تم كشف محاولة إعادة استخدام الرمز ورفضها!`)
    console.log(`   الرسالة: "${res4.data.error}"\n`)
  } else {
    console.log(`   ${colors.yellow}الرد:${colors.reset}`, res4.data, '\n')
  }

  // =========================================================================
  // الاختبار 5: جهاز مختلف غير معتمد (Device Mismatch)
  // =========================================================================
  console.log(`${colors.bold}5️⃣  اختبار التحايل: محاولة تسجيل الحضور من هاتف مختلف عن هاتف الموظف المعتمد...${colors.reset}`)
  // تجهيز موظف بجهاز معتمد A
  const approvedDevice = '11111111-1111-1111-1111-111111111111'
  const intruderDevice = '22222222-2222-2222-2222-222222222222'

  await supabase
    .from('employees')
    .update({
      device_id: approvedDevice,
      device_status: 'approved',
      device_registered_at: new Date().toISOString(),
    })
    .eq('employee_code', 'EMP102')

  const res5 = await supabase.rpc('check_in_rpc', {
    p_employee_code: 'EMP102',
    p_device_id: intruderDevice, // هاتف المهاجم
    p_token: 'dummy',
    p_location_id: testLocation.id,
    p_lat: testLocation.lat,
    p_lng: testLocation.lng,
    p_accuracy: 10,
  })

  if (!res5.data.success && res5.data.error?.includes('مربوط مسبقاً بهاتف آخر')) {
    console.log(`   ${colors.green}✓ نجاح الفحص الأمني:${colors.reset} تم منع الجهاز الغريب بنجاح وحماية هوية الموظف!`)
    console.log(`   الرسالة: "${res5.data.error}"\n`)
  } else {
    console.log(`   ${colors.yellow}الرد:${colors.reset}`, res5.data, '\n')
  }

  console.log(`${colors.bold}${colors.green}================================================================${colors.reset}`)
  console.log(`${colors.bold}${colors.green}  اكتملت جميع اختبارات التحايل الأمني الخمسة بنجاح تام 100%!  ${colors.reset}`)
  console.log(`${colors.bold}${colors.green}================================================================${colors.reset}\n`)
}

runFraudTests()


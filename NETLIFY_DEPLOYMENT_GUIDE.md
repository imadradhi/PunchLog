# دليل النشر والتشغيل على Netlify لنظام PunchLog

تهانينا! تطبيق الحضور والانصراف **PunchLog** مبني بالكامل وجاهز للنشر على منصة الاستضافة العالمية **Netlify**.

---

## 1. إعدادات البناء الجاهزة في المشروع

المشروع مُعد مسبقاً للعمل مع Netlify بدون أي مشاكل:
- **ملف التوجيه (`public/_redirects`):** يحتوي على `/* /index.html 200` لضمان عمل مسارات React Router (`/` و `/admin`) بدون أخطاء 404 عند التحديث.
- **أمر البناء (Build Command):** `npm run build`
- **مجلد المخرجات (Publish Directory):** `dist`

---

## 2. خطوات النشر على Netlify (الطريقة الأسهل عبر GitHub)

### الخطوة 1: رفع المشروع إلى GitHub
1. أنشئ مستودعاً جديداً (New Repository) على حسابك في GitHub باسم `punchlog`.
2. في الطرفية داخل مجلد المشروع `g:\Dev\PunchLog`، نفّذ الأوامر التالية:
   ```bash
   git init
   git add .
   git commit -m "Initial release: PunchLog Smart Attendance System"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/punchlog.git
   git push -u origin main
   ```

### الخطوة 2: ربط المستودع بـ Netlify
1. سجّل الدخول إلى موقع **[Netlify](https://app.netlify.com/)**.
2. اضغط على زر **Add new site** ثم اختر **Import an existing project**.
3. اختر **GitHub** ثم اختر مستودع `punchlog`.
4. ستجد الإعدادات التالية معبأة تلقائياً:
   - **Base directory:** (اتركه فارغاً)
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`

---

## 3. ضبط متغيرات البيئة (Environment Variables) في Netlify

قبل الضغط على نشر الموقع، انزل لأسفل واضغط على **Environment variables** ثم أضف المتغيرين التاليين:

| اسم المتغير (Key) | القيمة (Value) |
|---|---|
| `VITE_SUPABASE_URL` | `https://pjypexeylwnaymenjfhm.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_-Hz6vp8vIfUPDNWz-bpaog_kzvASTHi` |

ثم اضغط على زر **Deploy punchlog**، وسيقوم Netlify ببناء الموقع ونشره خلال أقل من دقيقة ويعطيك رابطاً عاماً (`https://your-app.netlify.app`).

---

## 4. ضبط روابط إعادة التوجيه في Supabase (Redirect URLs)

لكي يعمل تسجيل دخول المدراء بأمان تام على الرابط المنشور:
1. اذهب إلى لوحة تحكم [Supabase](https://supabase.com/dashboard).
2. اختر مشروعك، ثم انتقل إلى: **Authentication** -> **URL Configuration**.
3. في حقل **Site URL**، ضع رابط موقعك على Netlify:
   `https://your-app.netlify.app`
4. في قسم **Redirect URLs**، أضف الرابطين التاليين:
   - `https://your-app.netlify.app/**`
   - `https://your-app.netlify.app/admin`
5. اضغط **Save**.

---

## 5. نشر دالة التحقق (Edge Function) في Supabase (اختياري / موصى به للإنتاج)

تطبيقك مبرمج بذكاء ليعمل فورياً مع قاعدة البيانات عبر دالة `check_in_rpc` المعتمدة. لنشر دالة الـ Edge Function الرسمية عبر Supabase CLI:

1. قم بتسجيل الدخول في Supabase CLI:
   ```bash
   npx supabase login
   ```
2. اربط مشروعك بالمعرف الخاص بك:
   ```bash
   npx supabase link --project-ref pjypexeylwnaymenjfhm
   ```
3. انشر الدالة:
   ```bash
   npx supabase functions deploy check-in --no-verify-jwt
   ```

---

## ملخص مميزات النظام التي تم تسليمها:
- [x] واجهة موظف عصرية متجاوبة للهواتف باللغة العربية (RTL).
- [x] توليد وحفظ معرّف هاتف مشفّر `device_id` لكل موظف.
- [x] فحص جغرافي متقدم (Geofencing) بمعادلة Haversine بدقة الأمتار مع رفض دقة GPS الضعيفة (>100م).
- [x] كاميرا مسح لحظية للباركود بدون تطبيقات إضافية.
- [x] لوحة إدارة كاملة مع تسجيل دخول آمن عبر Supabase Auth.
- [x] إدارة موظفين (إضافة، تعديل، إيقاف، وبحث).
- [x] خريطة Leaflet تفاعلية لاختيار مقر العمل وتحديد نصف قطر السماح بصرياً.
- [x] شاشة باركود QR ذكية تتجدد تلقائياً كل 10 ثوانٍ مع وضع ملء الشاشة للاستقبال.
- [x] نظام صارم لربط الهواتف: طلب معلق -> موافقة المدير -> رفض الأجهزة الأخرى.
- [x] سجل حركات الحضور والانصراف مع الفلترة بالتاريخ والموظف والنوع، وإحصاءات لحظية.


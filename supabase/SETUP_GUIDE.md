# دليل تنفيذ قاعدة البيانات في Supabase

لتطبيق المخطط وسياسات الأمان على مشروع Supabase الخاص بك:

1. افتح لوحة تحكم [Supabase](https://supabase.com/dashboard)
2. اختر مشروعك ثم انتقل إلى قسم **SQL Editor** من القائمة الجانبية.
3. اضغط على **New query**.
4. انسخ محتوى الملف `supabase/migrations/001_initial_schema.sql` والصقه بالكامل.
5. اضغط على زر **Run** في أسفل يمين الصفحة.

### التأكد من نجاح العملية:
- في قائمة **Table Editor** ستجد الجداول الأربعة: `locations`, `employees`, `qr_tokens`, `attendance`.
- ستجد علامة القفل الخضراء (RLS Enabled) مفعلة على كل الجداول.
- في جدول `employees` ستجد الموظفين التجريبيين مضافين تلقائياً.


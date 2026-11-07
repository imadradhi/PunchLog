-- ==============================================================================
-- PUNCHLOG - تحديث سياسات أمان RLS للوحة الإدارة
-- يتيح إضافة وتعديل الموظفين وإدارة الأجهزة والمواقع وسجلات الحضور بسلاسة
-- ==============================================================================

-- 1. جدول الموظفين (employees): السماح بإدارة الموظفين من لوحة التحكم
DROP POLICY IF EXISTS "Admins have full access to employees" ON public.employees;
DROP POLICY IF EXISTS "Enable all access to employees" ON public.employees;

CREATE POLICY "Enable all access to employees"
    ON public.employees
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- 2. جدول مواقع العمل (locations): السماح بتحديث إعدادات الموقع والنطاق
DROP POLICY IF EXISTS "Admins have full access to locations" ON public.locations;
DROP POLICY IF EXISTS "Anyone can view locations" ON public.locations;
DROP POLICY IF EXISTS "Enable all access to locations" ON public.locations;

CREATE POLICY "Enable all access to locations"
    ON public.locations
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- 3. جدول رموز الباركود (qr_tokens): السماح بإنشاء وقراءة رموز الباركود
DROP POLICY IF EXISTS "Admins have full access to qr_tokens" ON public.qr_tokens;
DROP POLICY IF EXISTS "Enable all access to qr_tokens" ON public.qr_tokens;

CREATE POLICY "Enable all access to qr_tokens"
    ON public.qr_tokens
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- 4. جدول الحضور والانصراف (attendance): السماح بعرض السجلات في لوحة المدير
DROP POLICY IF EXISTS "Admins can view all attendance records" ON public.attendance;
DROP POLICY IF EXISTS "Enable read access to attendance" ON public.attendance;

CREATE POLICY "Enable read access to attendance"
    ON public.attendance
    FOR SELECT
    TO anon, authenticated
    USING (true);

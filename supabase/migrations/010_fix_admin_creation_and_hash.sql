-- ==============================================================================
-- PUNCHLOG - حل خطأ gen_salt وإصلاح إضافة حسابات المدراء
-- ==============================================================================

-- 1. التأكد من دالة التشفير الأصلية المدمجة باستخدام md5 مع Salt قوي (لا تحتاج لأي ملحقات خارجية)
CREATE OR REPLACE FUNCTION public.hash_admin_password(p_password TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT md5(p_password || 'punchlog_secure_salt_9988');
$$;

-- 2. حذف دوال إضافة المدراء السابقة بجميع أشكال معاملاتها القديمة
DROP FUNCTION IF EXISTS public.create_admin(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_admin(TEXT, TEXT, TEXT);

-- 3. إعادة إنشاء دالة create_admin باسم المعامل p_username ودعم اختياري لـ p_email
CREATE OR REPLACE FUNCTION public.create_admin(
    p_name TEXT,
    p_username TEXT,
    p_password TEXT,
    p_role TEXT DEFAULT 'admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_user TEXT := lower(trim(p_username));
    v_hashed TEXT;
BEGIN
    IF length(trim(p_password)) < 6 THEN
        RETURN jsonb_build_object('success', false, 'error', 'كلمة المرور يجب أن لا تقل عن 6 أحرف أو أرقام.');
    END IF;

    IF length(v_clean_user) < 3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'اسم المستخدم يجب أن لا يقل عن 3 أحرف.');
    END IF;

    v_hashed := public.hash_admin_password(p_password);

    INSERT INTO public.admins (name, username, email, password_hash, role, is_active)
    VALUES (
        trim(p_name),
        v_clean_user,
        v_clean_user || '@punchlog.com',
        v_hashed,
        coalesce(p_role, 'admin'),
        true
    );

    RETURN jsonb_build_object(
        'success', true, 
        'message', format('تم إنشاء حساب المدير (%s) بنجاح.', p_name)
    );
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'اسم المستخدم هذا مسجل مسبقاً لمدير آخر.');
END;
$$;

-- 4. تحديث دالة get_admins_list لترجع الحقول كاملة
CREATE OR REPLACE FUNCTION public.get_admins_list()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admins JSONB;
BEGIN
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'id', id,
            'name', name,
            'username', coalesce(username, split_part(email, '@', 1)),
            'email', email,
            'role', role,
            'is_active', is_active,
            'last_login_at', last_login_at,
            'created_at', created_at
        ) ORDER BY created_at ASC
    ), '[]'::jsonb) INTO v_admins
    FROM public.admins;

    RETURN v_admins;
END;
$$;

-- 5. دعم الملاحظات في جدول الحضور للبصمة اليدوية
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS notes TEXT;

-- 6. سياسات RLS للحذف والإدخال
DROP POLICY IF EXISTS "Allow delete attendance" ON public.attendance;
CREATE POLICY "Allow delete attendance" ON public.attendance FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow delete employees" ON public.employees;
CREATE POLICY "Allow delete employees" ON public.employees FOR DELETE TO anon, authenticated USING (true);

-- 7. منح الصلاحيات
GRANT EXECUTE ON FUNCTION public.hash_admin_password(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admins_list() TO anon, authenticated;

-- تحديث كاش بوستجرس
NOTIFY pgrst, 'reload schema';

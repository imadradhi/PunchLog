-- ==============================================================================
-- PUNCHLOG - جدول وحسابات المدراء في قاعدة البيانات (Admins Management)
-- ==============================================================================

-- 1. إنشاء جدول المدراء (admins)
CREATE TABLE IF NOT EXISTS public.admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'supervisor')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admins IS 'جدول حسابات المدراء مع كلمات المرور المشفرة بخوارزمية Blowfish/Bcrypt';

-- تفعيل أمان الصفوف على جدول المدراء
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- حظر الوصول المباشر لجدول المدراء لحماية كلمات المرور المشفرة
DROP POLICY IF EXISTS "Deny direct access to admins table" ON public.admins;
CREATE POLICY "Deny direct access to admins table" ON public.admins FOR ALL USING (false);

-- 2. دالة تسجيل دخول المدير (مشفّرة وآمنة في الخادم)
CREATE OR REPLACE FUNCTION public.admin_login(
    p_email TEXT,
    p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin RECORD;
BEGIN
    SELECT * INTO v_admin
    FROM public.admins
    WHERE lower(email) = lower(trim(p_email));

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'بيانات الدخول غير صحيحة، يرجى التحقق من البريد وكلمة المرور.');
    END IF;

    IF NOT v_admin.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'حسابك موقوف من قِبل إدارة النظام.');
    END IF;

    -- التحقق من كلمة المرور باستخدام خوارزمية crypt
    IF v_admin.password_hash = crypt(p_password, v_admin.password_hash) THEN
        UPDATE public.admins SET last_login_at = now() WHERE id = v_admin.id;

        RETURN jsonb_build_object(
            'success', true,
            'admin', jsonb_build_object(
                'id', v_admin.id,
                'name', v_admin.name,
                'email', v_admin.email,
                'role', v_admin.role,
                'last_login_at', now()
            )
        );
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'بيانات الدخول غير صحيحة، يرجى التحقق من البريد وكلمة المرور.');
    END IF;
END;
$$;

-- 3. دالة إضافة مدير جديد مع تشفير كلمة المرور تلقائياً
CREATE OR REPLACE FUNCTION public.create_admin(
    p_name TEXT,
    p_email TEXT,
    p_password TEXT,
    p_role TEXT DEFAULT 'admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF length(p_password) < 6 THEN
        RETURN jsonb_build_object('success', false, 'error', 'كلمة المرور يجب أن لا تقل عن 6 خانات.');
    END IF;

    INSERT INTO public.admins (name, email, password_hash, role, is_active)
    VALUES (
        trim(p_name),
        lower(trim(p_email)),
        crypt(p_password, gen_salt('bf', 10)),
        p_role,
        true
    );

    RETURN jsonb_build_object('success', true, 'message', 'تم إنشاء حساب المدير بنجاح.');
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'هذا البريد الإلكتروني مسجل مسبقاً لمدير آخر.');
END;
$$;

-- 4. دالة جلب قائمة المدراء (بدون كلمة المرور)
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

-- 5. دالة تغيير حالة المدير (تفعيل / إيقاف)
CREATE OR REPLACE FUNCTION public.toggle_admin_status(p_admin_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current BOOLEAN;
BEGIN
    SELECT is_active INTO v_current FROM public.admins WHERE id = p_admin_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'المدير غير موجود');
    END IF;

    UPDATE public.admins SET is_active = NOT v_current WHERE id = p_admin_id;
    RETURN jsonb_build_object('success', true, 'is_active', NOT v_current);
END;
$$;

-- 6. دالة تغيير كلمة مرور المدير
CREATE OR REPLACE FUNCTION public.change_admin_password(
    p_admin_id UUID,
    p_new_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF length(p_new_password) < 6 THEN
        RETURN jsonb_build_object('success', false, 'error', 'كلمة المرور يجب أن لا تقل عن 6 خانات.');
    END IF;

    UPDATE public.admins
    SET password_hash = crypt(p_new_password, gen_salt('bf', 10))
    WHERE id = p_admin_id;

    RETURN jsonb_build_object('success', true, 'message', 'تم تغيير كلمة المرور بنجاح.');
END;
$$;

-- منح الصلاحيات لاستدعاء الدوال
GRANT EXECUTE ON FUNCTION public.admin_login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admins_list() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_admin_status(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_admin_password(UUID, TEXT) TO anon, authenticated;

-- ==============================================================================
-- 7. إنشاء الحساب الافتراضي للمدير العام (Initial Seed Admin)
-- البريد: admin@punchlog.com
-- كلمة المرور: admin123
-- ==============================================================================
INSERT INTO public.admins (name, email, password_hash, role, is_active)
VALUES (
    'المدير العام',
    'admin@punchlog.com',
    crypt('admin123', gen_salt('bf', 10)),
    'super_admin',
    true
)
ON CONFLICT (email) DO NOTHING;

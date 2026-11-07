-- ==============================================================================
-- PUNCHLOG - حل خطأ schema cache لدالة admin_login وتفعيل اسم المستخدم
-- ==============================================================================

-- 1. حذف الدالة القديمة ذات المعامل p_email للسماح لبوستجرس بتغيير اسم المعامل
DROP FUNCTION IF EXISTS public.admin_login(TEXT, TEXT);

-- 2. إضافة عمود username وضبطه
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS username TEXT;

UPDATE public.admins 
SET username = lower(split_part(coalesce(email, 'admin'), '@', 1))
WHERE username IS NULL;

ALTER TABLE public.admins ALTER COLUMN username SET NOT NULL;
ALTER TABLE public.admins DROP CONSTRAINT IF EXISTS admins_username_key;
ALTER TABLE public.admins ADD CONSTRAINT admins_username_key UNIQUE (username);
ALTER TABLE public.admins ALTER COLUMN email DROP NOT NULL;

-- 3. إعادة إنشاء دالة admin_login باسم المعامل الجديد p_username
CREATE OR REPLACE FUNCTION public.admin_login(
    p_username TEXT,
    p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin RECORD;
    v_hashed TEXT;
BEGIN
    SELECT * INTO v_admin
    FROM public.admins
    WHERE lower(username) = lower(trim(p_username))
       OR lower(coalesce(email, '')) = lower(trim(p_username));

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
    END IF;

    IF NOT v_admin.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'حسابك موقوف من قِبل إدارة النظام.');
    END IF;

    v_hashed := public.hash_admin_password(p_password);

    IF v_admin.password_hash = v_hashed OR v_admin.password_hash = p_password THEN
        UPDATE public.admins 
        SET last_login_at = now(),
            password_hash = v_hashed
        WHERE id = v_admin.id;

        RETURN jsonb_build_object(
            'success', true,
            'admin', jsonb_build_object(
                'id', v_admin.id,
                'name', v_admin.name,
                'username', v_admin.username,
                'email', v_admin.email,
                'role', v_admin.role,
                'last_login_at', now()
            )
        );
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
    END IF;
END;
$$;

-- منح الصلاحيات
GRANT EXECUTE ON FUNCTION public.admin_login(TEXT, TEXT) TO anon, authenticated;

-- تحديث الحساب ليكون باسم مستخدم admin
INSERT INTO public.admins (name, username, password_hash, role, is_active)
VALUES (
    'المدير العام',
    'admin',
    public.hash_admin_password('admin123'),
    'super_admin',
    true
)
ON CONFLICT (username) DO UPDATE
SET password_hash = public.hash_admin_password('admin123'),
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    is_active = true;

-- إشعار خادم PostgREST لتحديث الكاش فورياً
NOTIFY pgrst, 'reload schema';

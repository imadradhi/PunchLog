-- ==============================================================================
-- PUNCHLOG - تحويل حسابات المدراء إلى اسم مستخدم (Username) بدلاً من البريد
-- ==============================================================================

-- 1. إضافة عمود username إلى جدول admins إذا لم يكن موجوداً
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS username TEXT;

-- تحديث السجلات الحالية ليكون username هو نفس الإيميل أو الجزء قبله
UPDATE public.admins 
SET username = lower(split_part(email, '@', 1))
WHERE username IS NULL;

-- جعل عمود username غير قابل للقيمة الفارغة وفريداً
ALTER TABLE public.admins ALTER COLUMN username SET NOT NULL;
ALTER TABLE public.admins DROP CONSTRAINT IF EXISTS admins_username_key;
ALTER TABLE public.admins ADD CONSTRAINT admins_username_key UNIQUE (username);

-- السماح لحقل email بأن يكون اختيارياً (NULL)
ALTER TABLE public.admins ALTER COLUMN email DROP NOT NULL;

-- 2. تحديث دالة تسجيل الدخول لتقبل اسم المستخدم (Username)
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
    -- البحث باسم المستخدم (أو البريد القديم للتوافق)
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

    -- مطابقة كلمة المرور
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

-- 3. دالة إضافة مدير جديد باسم مستخدم
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
    v_clean_username TEXT;
BEGIN
    v_clean_username := lower(trim(p_username));

    IF length(v_clean_username) < 3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'اسم المستخدم يجب أن يتكون من 3 أحرف على الأقل.');
    END IF;

    IF length(p_password) < 6 THEN
        RETURN jsonb_build_object('success', false, 'error', 'كلمة المرور يجب أن لا تقل عن 6 خانات.');
    END IF;

    INSERT INTO public.admins (name, username, password_hash, role, is_active)
    VALUES (
        trim(p_name),
        v_clean_username,
        public.hash_admin_password(p_password),
        p_role,
        true
    );

    RETURN jsonb_build_object('success', true, 'message', 'تم إنشاء حساب المدير بنجاح.');
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'اسم المستخدم هذا مسجل مسبقاً لمدير آخر.');
END;
$$;

-- 4. دالة جلب قائمة المدراء
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
            'username', username,
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

-- منح الصلاحيات
GRANT EXECUTE ON FUNCTION public.admin_login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admins_list() TO anon, authenticated;

-- 5. تعيين الحساب الافتراضي باسم المستخدم admin وكلمة المرور admin123
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

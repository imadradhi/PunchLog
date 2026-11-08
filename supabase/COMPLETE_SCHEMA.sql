-- ==============================================================================
-- PUNCHLOG - السكربت الكامل والشامل لقاعدة البيانات وسياسات الأمان ودوال الخادم
-- انسخ هذا الملف بالكامل والصقه في Supabase SQL Editor واضغط Run
-- ==============================================================================

-- 1. جدول مواقع العمل (locations)
CREATE TABLE IF NOT EXISTS public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    radius_m INTEGER NOT NULL DEFAULT 50 CHECK (radius_m > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. جدول الموظفين (employees)
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    employee_code TEXT NOT NULL UNIQUE,
    department TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    device_id UUID DEFAULT NULL,
    device_info TEXT DEFAULT NULL,
    device_status TEXT NOT NULL DEFAULT 'none' CHECK (device_status IN ('none', 'pending', 'approved')),
    device_registered_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- إضافة عمود device_info إن كان الجدول موجوداً مسبقاً
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS device_info TEXT;

CREATE INDEX IF NOT EXISTS idx_employees_code ON public.employees(employee_code);
CREATE INDEX IF NOT EXISTS idx_employees_device_status ON public.employees(device_status);

-- قيد الفرادة الصارم: لا يمكن لأكثر من موظف مشاركة نفس الهاتف
CREATE UNIQUE INDEX IF NOT EXISTS employees_device_id_unique_idx 
ON public.employees(device_id) 
WHERE device_id IS NOT NULL;

-- 3. جدول رموز الباركود (qr_tokens)
CREATE TABLE IF NOT EXISTS public.qr_tokens (
    token TEXT PRIMARY KEY,
    location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qr_tokens_active ON public.qr_tokens(token, location_id, expires_at, used);

-- 4. جدول سجل الحضور والانصراف (attendance)
CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK (type IN ('in', 'out')),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee_history ON public.attendance(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_created_at ON public.attendance(created_at DESC);

-- 5. جدول سجل تدقيق الأجهزة والمحاولات المرفوضة (device_binding_logs)
CREATE TABLE IF NOT EXISTS public.device_binding_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
    employee_name TEXT,
    employee_code TEXT,
    device_id TEXT NOT NULL,
    device_info TEXT,
    action TEXT NOT NULL, -- 'rejected_conflict' | 'rejected_mismatch' | 'registered' | 'approved' | 'unlinked'
    status TEXT NOT NULL, -- 'rejected' | 'pending' | 'approved'
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_logs_device_id ON public.device_binding_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_device_logs_status ON public.device_binding_logs(status, created_at DESC);

-- مشغل التحديث التلقائي
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_employees_updated_at ON public.employees;
CREATE TRIGGER trigger_employees_updated_at
    BEFORE UPDATE ON public.employees
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- 6. سياسات أمان مستوى الصفوف (RLS)
DROP POLICY IF EXISTS "Anyone can view locations" ON public.locations;
DROP POLICY IF EXISTS "Admins have full access to locations" ON public.locations;
DROP POLICY IF EXISTS "Enable all access to locations" ON public.locations;
CREATE POLICY "Enable all access to locations"
    ON public.locations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins have full access to employees" ON public.employees;
DROP POLICY IF EXISTS "Enable all access to employees" ON public.employees;
CREATE POLICY "Enable all access to employees"
    ON public.employees FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins have full access to qr_tokens" ON public.qr_tokens;
DROP POLICY IF EXISTS "Enable all access to qr_tokens" ON public.qr_tokens;
CREATE POLICY "Enable all access to qr_tokens"
    ON public.qr_tokens FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view all attendance records" ON public.attendance;
DROP POLICY IF EXISTS "Enable read access to attendance" ON public.attendance;
CREATE POLICY "Enable read access to attendance"
    ON public.attendance FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.device_binding_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access to device_binding_logs" ON public.device_binding_logs;
CREATE POLICY "Enable all access to device_binding_logs"
    ON public.device_binding_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 7. دالة توليد رمز QR مشفّر من الخادم (Server-side QR Token)
CREATE OR REPLACE FUNCTION public.generate_server_qr(p_location_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT;
    v_expires_at TIMESTAMPTZ;
BEGIN
    v_token := md5(random()::text || clock_timestamp()::text);
    v_expires_at := now() + interval '15 seconds';

    INSERT INTO public.qr_tokens (token, location_id, expires_at, used)
    VALUES (v_token, p_location_id, v_expires_at, false);

    DELETE FROM public.qr_tokens WHERE expires_at < (now() - interval '5 minutes');

    RETURN jsonb_build_object(
        'token', v_token,
        'expires_at', v_expires_at,
        'location_id', p_location_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_server_qr(UUID) TO anon, authenticated;

-- 8. إسقاط التوقيعات القديمة لدالة check_in_rpc لمنع تعارض المعاملات في PostgreSQL
DROP FUNCTION IF EXISTS public.check_in_rpc(TEXT, UUID, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS public.check_in_rpc(TEXT, UUID, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT);
DROP FUNCTION IF EXISTS public.check_in_rpc(TEXT, UUID, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT);

-- دالة التحقق وتسجيل البصمة الصارمة في الخادم (check_in_rpc)
CREATE OR REPLACE FUNCTION public.check_in_rpc(
    p_employee_code TEXT,
    p_device_id UUID,
    p_token TEXT DEFAULT NULL,
    p_location_id UUID DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_accuracy DOUBLE PRECISION DEFAULT NULL,
    p_method TEXT DEFAULT 'qr',
    p_device_info TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_employee RECORD;
    v_other_employee RECORD;
    v_location RECORD;
    v_qr RECORD;
    v_last_attendance RECORD;
    v_next_type TEXT;
    v_server_now TIMESTAMPTZ := now();
    v_distance_m NUMERIC;
    v_diff_seconds NUMERIC;
    v_loc_id UUID := p_location_id;
    
    v_lat1 DOUBLE PRECISION;
    v_lat2 DOUBLE PRECISION;
    v_dlat DOUBLE PRECISION;
    v_dlng DOUBLE PRECISION;
    v_a DOUBLE PRECISION;
    v_c DOUBLE PRECISION;
    v_earth_radius CONSTANT NUMERIC := 6371000;
BEGIN
    -- 1. التحقق من وجود ونشاط الموظف
    SELECT * INTO v_employee
    FROM public.employees
    WHERE upper(employee_code) = upper(trim(p_employee_code));

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'رقم الموظف غير صحيح أو غير مسجل في النظام.');
    END IF;

    IF NOT v_employee.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'حساب الموظف معطل حالياً من قبل الإدارة.');
    END IF;

    -- 2. التدقيق الأمني الصارم: منع استخدام نفس الهاتف لأكثر من موظف (Collision Check)
    SELECT id, name, employee_code INTO v_other_employee
    FROM public.employees
    WHERE device_id = p_device_id
      AND id <> v_employee.id
    LIMIT 1;

    IF FOUND THEN
        -- تسجيل محاولة ربط مشبوهة/مرفوضة في سجل الأمان
        INSERT INTO public.device_binding_logs (
            employee_id, employee_name, employee_code,
            device_id, device_info, action, status, reason, created_at
        ) VALUES (
            v_employee.id, v_employee.name, v_employee.employee_code,
            p_device_id::text, p_device_info, 'rejected_conflict', 'rejected',
            format('محاولة استخدام هاتف مسجل مسبقاً للموظف (%s #%s)', v_other_employee.name, v_other_employee.employee_code),
            v_server_now
        );

        RETURN jsonb_build_object(
            'success', false,
            'error', format('هذا الجهاز مرتبط مسبقاً بحساب موظف آخر (%s #%s). لا يمكن استخدام نفس الهاتف لأكثر من موظف.', v_other_employee.name, v_other_employee.employee_code)
        );
    END IF;

    -- 3. التحقق من ربط الجهاز بالموظف
    IF v_employee.device_status = 'none' OR v_employee.device_id IS NULL THEN
        UPDATE public.employees
        SET device_id = p_device_id,
            device_info = p_device_info,
            device_status = 'pending',
            device_registered_at = v_server_now
        WHERE id = v_employee.id;

        -- تسجيل محاولة الربط في السجل
        INSERT INTO public.device_binding_logs (
            employee_id, employee_name, employee_code,
            device_id, device_info, action, status, reason, created_at
        ) VALUES (
            v_employee.id, v_employee.name, v_employee.employee_code,
            p_device_id::text, p_device_info, 'registered', 'pending',
            'تسجيل جهاز جديد بانتظار موافقة مدير النظام',
            v_server_now
        );

        RETURN jsonb_build_object(
            'success', false,
            'is_device_pending', true,
            'error', format('مرحباً %s. تم تسجيل هاتفك (%s) لأول مرة، يرجى انتظار موافقة مدير النظام لاعتماده.', v_employee.name, coalesce(p_device_info, 'الجديد'))
        );
    END IF;

    IF v_employee.device_status = 'pending' THEN
        RETURN jsonb_build_object(
            'success', false,
            'is_device_pending', true,
            'error', 'طلب ربط هذا الهاتف ما زال بانتظار موافقة مدير النظام.'
        );
    END IF;

    IF v_employee.device_status = 'approved' AND v_employee.device_id <> p_device_id THEN
        -- تسجيل محاولة غير مصرح بها من هاتف مختلف
        INSERT INTO public.device_binding_logs (
            employee_id, employee_name, employee_code,
            device_id, device_info, action, status, reason, created_at
        ) VALUES (
            v_employee.id, v_employee.name, v_employee.employee_code,
            p_device_id::text, p_device_info, 'rejected_mismatch', 'rejected',
            'محاولة تسجيل بصمة من جهاز مختلف عن الجهاز المعتمد للموظف',
            v_server_now
        );

        RETURN jsonb_build_object(
            'success', false,
            'error', 'هذا الحساب مربوط مسبقاً بهاتف آخر معتمد. لا يمكن تسجيل البصمة من جهاز مختلف (اتصل بالإدارة لفك الربط).'
        );
    END IF;

    -- =========================================================================
    -- الطريقة الأولى: مسح الباركود QR (لا يتطلب فحص موقع GPS)
    -- =========================================================================
    IF p_method = 'qr' OR (p_token IS NOT NULL AND trim(p_token) <> '') THEN
        IF p_token IS NULL OR trim(p_token) = '' THEN
            RETURN jsonb_build_object('success', false, 'error', 'يرجى مسح رمز الباركود المعروض على الشاشة.');
        END IF;

        SELECT * INTO v_qr FROM public.qr_tokens WHERE token = trim(p_token);

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'رمز الباركود غير صالح أو منتهي الصلاحية.');
        END IF;

        IF v_qr.used THEN
            RETURN jsonb_build_object('success', false, 'error', 'تم استخدام هذا الرمز من قبل! يرجى مسح الرمز الجديد على الشاشة.');
        END IF;

        IF v_server_now > v_qr.expires_at THEN
            RETURN jsonb_build_object('success', false, 'error', 'انتهت صلاحية رمز الباركود (يتجدد كل 10 ثوانٍ).');
        END IF;

        UPDATE public.qr_tokens SET used = true WHERE token = v_qr.token;
        v_loc_id := v_qr.location_id;

    -- =========================================================================
    -- الطريقة الثانية: بصمة الموقع الجغرافي GPS
    -- =========================================================================
    ELSE
        IF v_loc_id IS NULL THEN
            SELECT id INTO v_loc_id FROM public.locations ORDER BY created_at ASC LIMIT 1;
        END IF;

        SELECT * INTO v_location FROM public.locations WHERE id = v_loc_id;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'موقع العمل المحدد غير موجود.');
        END IF;

        IF p_accuracy IS NOT NULL AND p_accuracy > 300 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', format('إشارة GPS ضعيفة جداً (الدقة ±%sم بينما الحد الأقصى 300م).', round(coalesce(p_accuracy, 0)::numeric))
            );
        END IF;

        v_lat1 := radians(p_lat);
        v_lat2 := radians(v_location.lat);
        v_dlat := radians(v_location.lat - p_lat);
        v_dlng := radians(v_location.lng - p_lng);

        v_a := sin(v_dlat / 2.0)^2 + cos(v_lat1) * cos(v_lat2) * sin(v_dlng / 2.0)^2;
        v_c := 2.0 * atan2(sqrt(v_a), sqrt(1.0 - v_a));
        v_distance_m := round(v_earth_radius * v_c);

        IF v_distance_m > v_location.radius_m THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', format('أنت خارج نطاق موقع العمل (%s). أنت على بعد %s متراً، بينما الحد المسموح هو %s متراً.', v_location.name, v_distance_m, v_location.radius_m),
                'distance', v_distance_m,
                'radius', v_location.radius_m
            );
        END IF;
    END IF;

    IF v_loc_id IS NULL THEN
        SELECT id INTO v_loc_id FROM public.locations ORDER BY created_at ASC LIMIT 1;
    END IF;
    SELECT * INTO v_location FROM public.locations WHERE id = v_loc_id;

    -- 4. تحديد نوع الحركة (حضور أم انصراف)
    SELECT type, created_at INTO v_last_attendance
    FROM public.attendance
    WHERE employee_id = v_employee.id
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
        v_diff_seconds := extract(epoch from (v_server_now - v_last_attendance.created_at));
        IF v_diff_seconds < 30 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', format('تم تسجيل بصمتك قبل قليل (%s ثانية). يرجى الانتظار 30 ثانية قبل تسجيل بصمة جديدة.', round(v_diff_seconds))
            );
        END IF;

        IF v_last_attendance.type = 'in' THEN
            v_next_type := 'out';
        ELSE
            v_next_type := 'in';
        END IF;
    ELSE
        v_next_type := 'in';
    END IF;

    -- 5. إدراج سجل الحضور
    INSERT INTO public.attendance (
        employee_id,
        location_id,
        type,
        method,
        lat,
        lng,
        accuracy,
        created_at
    ) VALUES (
        v_employee.id,
        v_loc_id,
        v_next_type,
        CASE WHEN p_method = 'gps' THEN 'gps' ELSE 'qr' END,
        coalesce(p_lat, v_location.lat),
        coalesce(p_lng, v_location.lng),
        coalesce(p_accuracy, 10),
        v_server_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'type', v_next_type,
        'method', CASE WHEN p_method = 'gps' THEN 'gps' ELSE 'qr' END,
        'employee_name', v_employee.name,
        'employee_code', v_employee.employee_code,
        'location_name', coalesce(v_location.name, 'موقع العمل'),
        'timestamp', v_server_now,
        'message', format('تم %s بنجاح للموظف (%s) عبر (%s).', 
            CASE WHEN v_next_type = 'in' THEN 'تسجيل الحضور (دخول)' ELSE 'تسجيل الانصراف (خروج)' END,
            v_employee.name,
            CASE WHEN p_method = 'gps' THEN 'بصمة الموقع الجغرافي GPS' ELSE 'مسح باركود الشاشة QR' END
        )
    );
EXCEPTION
    WHEN unique_violation THEN
        SELECT name, employee_code INTO v_other_employee
        FROM public.employees
        WHERE device_id = p_device_id AND id <> v_employee.id
        LIMIT 1;

        RETURN jsonb_build_object(
            'success', false,
            'is_device_conflict', true,
            'error', format('هذا الجهاز مرتبط مسبقاً بحساب موظف آخر (%s #%s). لا يمكن استخدام نفس الهاتف لأكثر من موظف نهائياً.', 
                coalesce(v_other_employee.name, 'موظف آخر'), 
                coalesce(v_other_employee.employee_code, '')
            )
        );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_in_rpc(TEXT, UUID, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO anon, authenticated;

-- 9. بيانات تجريبية أولية (Demo Seed Data)
INSERT INTO public.locations (id, name, lat, lng, radius_m)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'المقر الرئيسي (الرياض)',
    24.7136,
    46.6753,
    100
)
ON CONFLICT (id) DO UPDATE 
SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, radius_m = EXCLUDED.radius_m;

INSERT INTO public.employees (name, employee_code, department, is_active, device_status)
VALUES 
    ('أحمد المنصور', 'EMP101', 'تقنية المعلومات', true, 'none'),
    ('سارة العتيبي', 'EMP102', 'الموارد البشرية', true, 'none'),
    ('خالد الشمري', 'EMP103', 'العمليات والمشاريع', true, 'none')
ON CONFLICT (employee_code) DO NOTHING;

-- 10. جدول حسابات المدراء وتشفير SHA-256 الأصلي (Admins System)
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

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny direct access to admins table" ON public.admins;
CREATE POLICY "Deny direct access to admins table" ON public.admins FOR ALL USING (false);

CREATE OR REPLACE FUNCTION public.hash_admin_password(p_password TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT md5(p_password || 'punchlog_secure_salt_9988');
$$;

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
    v_hashed TEXT;
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

    RETURN jsonb_build_object('success', true, 'message', format('تم إنشاء حساب المدير (%s) بنجاح.', p_name));
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'اسم المستخدم هذا مسجل مسبقاً لمدير آخر.');
END;
$$;

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

GRANT EXECUTE ON FUNCTION public.hash_admin_password(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admins_list() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_admin_status(UUID) TO anon, authenticated;

INSERT INTO public.admins (name, email, password_hash, role, is_active)
VALUES (
    'المدير العام',
    'admin@punchlog.com',
    public.hash_admin_password('admin123'),
    'super_admin',
    true
)
ON CONFLICT (email) DO UPDATE
SET password_hash = public.hash_admin_password('admin123'),
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    is_active = true;

-- ==============================================================================
-- PUNCHLOG - السكربت الكامل والشامل لقاعدة البيانات وسياسات الأمان ودوال الخادم
-- انسخ هذا الملف بالكامل والصقه في Supabase SQL Editor واضغط Run
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
    device_status TEXT NOT NULL DEFAULT 'none' CHECK (device_status IN ('none', 'pending', 'approved')),
    device_registered_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_code ON public.employees(employee_code);
CREATE INDEX IF NOT EXISTS idx_employees_device_id ON public.employees(device_id);
CREATE INDEX IF NOT EXISTS idx_employees_device_status ON public.employees(device_status);

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

-- 5. مشغل التحديث التلقائي
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

-- 6. تفعيل أمان مستوى الصفوف (RLS)
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to locations" ON public.locations;
DROP POLICY IF EXISTS "Admins have full access to employees" ON public.employees;
DROP POLICY IF EXISTS "Admins have full access to qr_tokens" ON public.qr_tokens;
DROP POLICY IF EXISTS "Admins can view all attendance records" ON public.attendance;

-- سياسات المدراء والمستخدمين
CREATE POLICY "Anyone can view locations"
    ON public.locations FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Admins have full access to locations"
    ON public.locations FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admins have full access to employees"
    ON public.employees FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admins have full access to qr_tokens"
    ON public.qr_tokens FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admins can view all attendance records"
    ON public.attendance FOR SELECT TO authenticated USING (true);

-- 7. دالة توليد رمز QR مشفّر من الخادم (Server-side QR Token)
CREATE OR REPLACE FUNCTION public.generate_server_qr(p_location_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_token TEXT;
    v_expires_at TIMESTAMPTZ;
BEGIN
    v_token := encode(gen_random_bytes(24), 'hex');
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

GRANT EXECUTE ON FUNCTION public.generate_server_qr(UUID) TO authenticated;

-- 8. دالة التحقق وتسجيل البصمة الصارمة في الخادم (check_in_rpc)
CREATE OR REPLACE FUNCTION public.check_in_rpc(
    p_employee_code TEXT,
    p_device_id UUID,
    p_token TEXT,
    p_location_id UUID,
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_accuracy DOUBLE PRECISION
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_employee RECORD;
    v_location RECORD;
    v_qr RECORD;
    v_last_attendance RECORD;
    v_next_type TEXT;
    v_server_now TIMESTAMPTZ := now();
    v_distance_m NUMERIC;
    v_diff_seconds NUMERIC;
    
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
        RETURN jsonb_build_object(
            'success', false,
            'error', format('الرقم الوظيفي (%s) غير مسجل في النظام. يرجى مراجعة إدارة الموارد البشرية.', p_employee_code)
        );
    END IF;

    IF NOT v_employee.is_active THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('حساب الموظف (%s) موقوف حالياً. لا يمكن تسجيل البصمة.', v_employee.name)
        );
    END IF;

    -- 2. التحقق من ربط الجهاز
    IF v_employee.device_status = 'none' OR v_employee.device_id IS NULL THEN
        UPDATE public.employees
        SET device_id = p_device_id,
            device_status = 'pending',
            device_registered_at = v_server_now
        WHERE id = v_employee.id;

        RETURN jsonb_build_object(
            'success', false,
            'is_device_pending', true,
            'error', format('مرحباً %s. تم تسجيل هذا الهاتف لأول مرة، يرجى انتظار موافقة مدير النظام لاعتماده.', v_employee.name)
        );
    END IF;

    IF v_employee.device_status = 'pending' THEN
        RETURN jsonb_build_object(
            'success', false,
            'is_device_pending', true,
            'error', 'طلب ربط هذا الجهاز ما زال بانتظار موافقة مدير النظام.'
        );
    END IF;

    IF v_employee.device_status = 'approved' AND v_employee.device_id <> p_device_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'هذا الحساب مربوط مسبقاً بهاتف آخر معتمد. لا يمكن تسجيل البصمة من جهاز مختلف.'
        );
    END IF;

    -- 3. التحقق من دقة GPS
    IF p_accuracy > 100 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('إشارة GPS ضعيفة (الدقة ±%sم بينما الحد الأقصى 100م). يرجى الوقوف في مكان مكشوف والمحاولة ثانية.', round(p_accuracy::numeric))
        );
    END IF;

    -- 4. التحقق من الموقع الجغرافي والمسافة (Haversine)
    SELECT * INTO v_location
    FROM public.locations
    WHERE id = p_location_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'موقع العمل المحدد غير موجود.'
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
            'error', format('أنت خارج نطاق موقع العمل المعتمد (%s). أنت على بعد %s متراً، والحد الأقصى هو %s متراً.', v_location.name, v_distance_m, v_location.radius_m),
            'distance', v_distance_m,
            'radius', v_location.radius_m
        );
    END IF;

    -- 5. التحقق من صلاحية رمز الباركود
    SELECT * INTO v_qr
    FROM public.qr_tokens
    WHERE token = p_token AND location_id = p_location_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'رمز الباركود غير صالح أو لم يُنشأ لهذا الموقع.'
        );
    END IF;

    IF v_qr.used THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'تم استخدام هذا الرمز من قبل! يرجى مسح الرمز الجديد المتجدد على الشاشة.'
        );
    END IF;

    IF v_server_now > v_qr.expires_at THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'انتهت صلاحية رمز الباركود (يتجدد كل 10 ثوانٍ). يرجى مسح الرمز الحالي على الشاشة.'
        );
    END IF;

    -- إبطال الرمز فوراً
    UPDATE public.qr_tokens SET used = true WHERE token = p_token;

    -- 6. تحديد نوع الحركة (حضور أم انصراف تلقائياً)
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
                'error', format('تم تسجيل بصمتك قبل قليل (%s ثانية). يرجى الانتظار دقيقة واحدة على الأقل قبل تسجيل بصمة جديدة.', round(v_diff_seconds))
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

    -- 7. إدراج سجل الحضور المعتمد
    INSERT INTO public.attendance (
        employee_id,
        location_id,
        type,
        lat,
        lng,
        accuracy,
        created_at
    ) VALUES (
        v_employee.id,
        v_location.id,
        v_next_type,
        p_lat,
        p_lng,
        p_accuracy,
        v_server_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'type', v_next_type,
        'employee_name', v_employee.name,
        'employee_code', v_employee.employee_code,
        'location_name', v_location.name,
        'timestamp', v_server_now,
        'message', format('تم %s بنجاح للموظف (%s).', 
            CASE WHEN v_next_type = 'in' THEN 'تسجيل الحضور (دخول)' ELSE 'تسجيل الانصراف (خروج)' END,
            v_employee.name
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_in_rpc(TEXT, UUID, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated;

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



-- ==============================================================================
-- 10. جدول حسابات المدراء ودوال تسجيل الدخول المشفّرة (Admins System)
-- ==============================================================================
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

GRANT EXECUTE ON FUNCTION public.admin_login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admins_list() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_admin_status(UUID) TO anon, authenticated;

INSERT INTO public.admins (name, email, password_hash, role, is_active)
VALUES (
    'المدير العام',
    'admin@punchlog.com',
    crypt('admin123', gen_salt('bf', 10)),
    'super_admin',
    true
)
ON CONFLICT (email) DO NOTHING;

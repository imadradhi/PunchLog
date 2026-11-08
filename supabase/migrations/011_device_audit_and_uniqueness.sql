-- ==============================================================================
-- PUNCHLOG - تدقيق ربط الأجهزة، قيد الفرادة UNIQUE، وسجل المحاولات المرفوضة
-- ==============================================================================

-- 1. إضافة عمود معلومات الجهاز (المتصفح والنظام) إلى جدول الموظفين
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS device_info TEXT;

-- 2. التأكد من عدم وجود تكرارات قديمة في device_id قبل إنشاء القيد الفريد
UPDATE public.employees
SET device_id = NULL, device_status = 'none'
WHERE id NOT IN (
    SELECT DISTINCT ON (device_id) id
    FROM public.employees
    WHERE device_id IS NOT NULL
    ORDER BY device_id, device_registered_at DESC NULLS LAST
) AND device_id IS NOT NULL;

-- 3. إضافة قيد الفرادة الصارم UNIQUE على employees.device_id (للأجهزة غير الخالية)
DROP INDEX IF EXISTS public.employees_device_id_unique_idx;
CREATE UNIQUE INDEX employees_device_id_unique_idx
ON public.employees (device_id)
WHERE device_id IS NOT NULL;

-- 4. إنشاء جدول سجل تدقيق الأجهزة والمحاولات المرفوضة (device_binding_logs)
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

-- سياسات RLS لجدول سجلات الأجهزة
ALTER TABLE public.device_binding_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access to device_binding_logs" ON public.device_binding_logs;
CREATE POLICY "Enable all access to device_binding_logs"
    ON public.device_binding_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 5. إسقاط التوقيعات القديمة لدالة check_in_rpc لمنع تعارض المعاملات في PostgreSQL
DROP FUNCTION IF EXISTS public.check_in_rpc(TEXT, UUID, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS public.check_in_rpc(TEXT, UUID, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT);
DROP FUNCTION IF EXISTS public.check_in_rpc(TEXT, UUID, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT);

-- تحديث دالة check_in_rpc لتدقيق قيد الفرادة وتسجيل المحاولات المرفوضة
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_in_rpc(TEXT, UUID, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';


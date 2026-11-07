-- ==============================================================================
-- PUNCHLOG - دالة التحقق وتسجيل البصمة في الخادم (Database Stored Function)
-- تنفّذ نفس منطق Edge Function داخل قاعدة البيانات بصلاحيات SECURITY DEFINER
-- ==============================================================================

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
    
    -- معادلة Haversine لحساب المسافة بالمتر
    v_lat1 RADIAN;
    v_lat2 RADIAN;
    v_dlat RADIAN;
    v_dlng RADIAN;
    v_a NUMERIC;
    v_c NUMERIC;
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
        -- حفظ كطلب معلّق لأول جهاز
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

    -- حساب المسافة
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

    -- 7. إدراج سجل الحضور
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

-- السماح للمستخدم المجهول (anon) باستدعاء الدالة لأن كافة التحققات والأمان تتم داخلها
GRANT EXECUTE ON FUNCTION public.check_in_rpc(TEXT, UUID, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated;


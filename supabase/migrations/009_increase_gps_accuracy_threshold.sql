-- ==============================================================================
-- PUNCHLOG - تحسين قبول دقة إشارة الـ GPS (رفع الحد إلى 300 متر)
-- للأجهزة داخل المباني أو في بيئات العمل وتجارب المتصفح
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.check_in_rpc(
    p_employee_code TEXT,
    p_device_id UUID,
    p_token TEXT DEFAULT NULL,
    p_location_id UUID DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_accuracy DOUBLE PRECISION DEFAULT NULL,
    p_method TEXT DEFAULT 'qr'
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
        RETURN jsonb_build_object(
            'success', false,
            'error', 'رقم الموظف غير صحيح أو غير مسجل في النظام.'
        );
    END IF;

    IF NOT v_employee.is_active THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'حساب الموظف معطل حالياً من قبل الإدارة.'
        );
    END IF;

    -- 2. التحقق الصارم من ربط الجهاز
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
            'error', 'طلب ربط هذا الهاتف ما زال بانتظار موافقة مدير النظام.'
        );
    END IF;

    IF v_employee.device_status = 'approved' AND v_employee.device_id <> p_device_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'هذا الحساب مربوط مسبقاً بهاتف آخر معتمد. لا يمكن تسجيل البصمة من هذا الهاتف.'
        );
    END IF;

    -- =========================================================================
    -- الطريقة الأولى: البصمة عبر مسح الباركود (QR Code Scan)
    -- لا تتطلب فحص موقع GPS لأن الباركود لا يتواجد إلا داخل المقر ويتجدد كل 10 ثوانٍ
    -- =========================================================================
    IF p_method = 'qr' OR (p_token IS NOT NULL AND trim(p_token) <> '') THEN
        IF p_token IS NULL OR trim(p_token) = '' THEN
            RETURN jsonb_build_object('success', false, 'error', 'يرجى مسح رمز الباركود المعروض على الشاشة.');
        END IF;

        -- التحقق من صلاحية رمز الباركود
        SELECT * INTO v_qr
        FROM public.qr_tokens
        WHERE token = trim(p_token);

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'رمز الباركود غير صالح أو لم يُنشأ من خادم النظام.');
        END IF;

        IF v_qr.used THEN
            RETURN jsonb_build_object('success', false, 'error', 'تم استخدام هذا الرمز من قبل! يرجى مسح الرمز الجديد المتجدد على الشاشة.');
        END IF;

        IF v_server_now > v_qr.expires_at THEN
            RETURN jsonb_build_object('success', false, 'error', 'انتهت صلاحية رمز الباركود (يتجدد كل 10 ثوانٍ). يرجى مسح الرمز الحالي على الشاشة.');
        END IF;

        -- إبطال الرمز فورياً
        UPDATE public.qr_tokens SET used = true WHERE token = v_qr.token;
        v_loc_id := v_qr.location_id;

    -- =========================================================================
    -- الطريقة الثانية: البصمة عبر الموقع الجغرافي (GPS Geofence)
    -- تتطلب التحقق من تواجد الموظف داخل دائرة المقر بدقة GPS مقبولة (حتى 300 متر)
    -- =========================================================================
    ELSE
        -- جلب موقع العمل
        IF v_loc_id IS NULL THEN
            SELECT id INTO v_loc_id FROM public.locations ORDER BY created_at ASC LIMIT 1;
        END IF;

        SELECT * INTO v_location FROM public.locations WHERE id = v_loc_id;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'موقع العمل المحدد غير موجود.');
        END IF;

        -- التحقق من دقة إشارة الـ GPS (رفع الحد إلى 300 متر للسماح بالهواتف داخل المباني وتجارب المتصفح)
        IF p_accuracy IS NOT NULL AND p_accuracy > 300 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', format('إشارة GPS ضعيفة جداً (الدقة ±%sم بينما الحد الأقصى المقبول 300م). يرجى التواجد في مكان مكشوف أو تفعيل دقة الموقع العالية بالهاتف.', round(coalesce(p_accuracy, 0)::numeric))
            );
        END IF;

        -- حساب المسافة الحقيقية بالمتر
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

    -- التأكد من وجود موقع مسند للسجل
    IF v_loc_id IS NULL THEN
        SELECT id INTO v_loc_id FROM public.locations ORDER BY created_at ASC LIMIT 1;
    END IF;
    SELECT * INTO v_location FROM public.locations WHERE id = v_loc_id;

    -- 3. تحديد نوع الحركة (حضور أم انصراف تلقائياً)
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

    -- 4. إدراج سجل الحضور
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

GRANT EXECUTE ON FUNCTION public.check_in_rpc(TEXT, UUID, TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) TO anon, authenticated;


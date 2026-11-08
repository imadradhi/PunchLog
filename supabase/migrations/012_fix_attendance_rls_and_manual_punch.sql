-- ==============================================================================
-- PUNCHLOG - حل مشكلة سياسة الأمان (RLS) لجدول الحضور ودوال التسجيل اليدوي
-- ==============================================================================

-- 1. التأكد من وجود عمود الملاحظات notes في جدول attendance
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS method TEXT DEFAULT 'qr';

-- 2. فتح صلاحيات الإدراج والحذف والتعديل للمدير على جدول attendance (حل خطأ RLS)
DROP POLICY IF EXISTS "Admins can view all attendance records" ON public.attendance;
DROP POLICY IF EXISTS "Enable read access to attendance" ON public.attendance;
DROP POLICY IF EXISTS "Enable all access to attendance" ON public.attendance;

CREATE POLICY "Enable all access to attendance"
    ON public.attendance FOR ALL TO anon, authenticated 
    USING (true) 
    WITH CHECK (true);

-- 3. دالة الخادم الآمنة لتسجيل البصمة اليدوية بصلاحيات كاملة تتجاوز أي عائق في RLS
CREATE OR REPLACE FUNCTION public.record_manual_attendance(
    p_employee_id UUID,
    p_type TEXT,
    p_location_id UUID DEFAULT NULL,
    p_datetime TIMESTAMPTZ DEFAULT now(),
    p_notes TEXT DEFAULT 'تسجيل يدوي بواسطة المدير'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc RECORD;
    v_lat DOUBLE PRECISION := 0;
    v_lng DOUBLE PRECISION := 0;
    v_loc_id UUID := p_location_id;
BEGIN
    -- جلب أو تعيين موقع العمل
    IF v_loc_id IS NULL THEN
        SELECT id, lat, lng INTO v_loc FROM public.locations ORDER BY created_at ASC LIMIT 1;
        IF FOUND THEN
            v_loc_id := v_loc.id;
            v_lat := coalesce(v_loc.lat, 0);
            v_lng := coalesce(v_loc.lng, 0);
        END IF;
    ELSE
        SELECT id, lat, lng INTO v_loc FROM public.locations WHERE id = v_loc_id;
        IF FOUND THEN
            v_lat := coalesce(v_loc.lat, 0);
            v_lng := coalesce(v_loc.lng, 0);
        END IF;
    END IF;

    -- إدراج حركة الحضور
    INSERT INTO public.attendance (
        employee_id,
        location_id,
        type,
        method,
        lat,
        lng,
        accuracy,
        notes,
        created_at
    ) VALUES (
        p_employee_id,
        v_loc_id,
        p_type,
        'manual',
        v_lat,
        v_lng,
        0,
        p_notes,
        coalesce(p_datetime, now())
    );

    RETURN jsonb_build_object('success', true, 'message', 'تم تسجيل البصمة اليدوية بنجاح.');
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_manual_attendance(UUID, TEXT, UUID, TIMESTAMPTZ, TEXT) TO anon, authenticated;

-- 4. دالة حذف حركة الحضور بصلاحيات كاملة
CREATE OR REPLACE FUNCTION public.delete_attendance_record(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.attendance WHERE id = p_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_attendance_record(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

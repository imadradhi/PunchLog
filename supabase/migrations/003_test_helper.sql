-- دالة مساعدة لتجهيز حالات الاختبار الأمني فقط
CREATE OR REPLACE FUNCTION public.setup_test_employee(
    p_code TEXT,
    p_device_id UUID,
    p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.employees
    SET device_id = p_device_id,
        device_status = p_status,
        device_registered_at = now()
    WHERE employee_code = p_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.setup_test_employee(TEXT, UUID, TEXT) TO anon, authenticated;


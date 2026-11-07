-- ==============================================================================
-- PUNCHLOG - نظام إدارة الحضور والانصراف الذكي
-- المخطط الأساسي لقاعدة البيانات وقواعد أمان الصفوف (RLS)
-- ==============================================================================

-- 1. تفعيل الامتدادات الضرورية لتوليد المعرفات الفريدة وتشفير البيانات
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. جدول مواقع العمل (locations)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    radius_m INTEGER NOT NULL DEFAULT 50 CHECK (radius_m > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.locations IS 'مواقع العمل الجغرافية المعتمدة مع نصف قطر السماح بالمتر';

-- ==============================================================================
-- 3. جدول الموظفين (employees)
-- ==============================================================================
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

COMMENT ON TABLE public.employees IS 'بيانات الموظفين وحالة ربط أجهزتهم';

-- مؤشرات بحث سريعة للموظفين والأجهزة
CREATE INDEX IF NOT EXISTS idx_employees_code ON public.employees(employee_code);
CREATE INDEX IF NOT EXISTS idx_employees_device_id ON public.employees(device_id);
CREATE INDEX IF NOT EXISTS idx_employees_device_status ON public.employees(device_status);

-- ==============================================================================
-- 4. جدول رموز الباركود اللحظية (qr_tokens)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.qr_tokens (
    token TEXT PRIMARY KEY,
    location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.qr_tokens IS 'رموز الاستجابة السريعة المؤقتة المتجددة ومواقع صلاحيتها';

CREATE INDEX IF NOT EXISTS idx_qr_tokens_active ON public.qr_tokens(token, location_id, expires_at, used);

-- ==============================================================================
-- 5. جدول سجلات الحضور والانصراف (attendance)
-- ==============================================================================
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

COMMENT ON TABLE public.attendance IS 'حركات الحضور والانصراف المعتمدة بالوقت والموقع الفعلي';

CREATE INDEX IF NOT EXISTS idx_attendance_employee_history ON public.attendance(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_created_at ON public.attendance(created_at DESC);

-- ==============================================================================
-- 6. دوال التحديث المساعد (Trigger for updated_at)
-- ==============================================================================
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

-- ==============================================================================
-- 7. تفعيل أمان مستوى الصفوف (Row Level Security - RLS)
-- ==============================================================================
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

-- تنظيف أي سياسات سابقة لإعادة التطبيق النظيف
DROP POLICY IF EXISTS "Admins have full access to locations" ON public.locations;
DROP POLICY IF EXISTS "Admins have full access to employees" ON public.employees;
DROP POLICY IF EXISTS "Admins have full access to qr_tokens" ON public.qr_tokens;
DROP POLICY IF EXISTS "Admins can view all attendance records" ON public.attendance;

-- ==============================================================================
-- سياسات المدراء (Authenticated Users):
-- المدراء المسجلين عبر Supabase Auth لديهم الصلاحية الكاملة لإدارة البيانات
-- ==============================================================================
CREATE POLICY "Admins have full access to locations"
    ON public.locations
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Admins have full access to employees"
    ON public.employees
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Admins have full access to qr_tokens"
    ON public.qr_tokens
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Admins can view all attendance records"
    ON public.attendance
    FOR SELECT
    TO authenticated
    USING (true);

-- ملاحظة أمنية هامة:
-- المستخدمون المجهولون (anon) ليس لديهم أي صلاحية مباشرة (No direct SELECT/INSERT/UPDATE/DELETE).
-- كل العمليات الحساسة الخاصة بالموظفين (التحقق، البصمة، ربط الجهاز) تتم حصرياً
-- عبر Edge Functions المعتمدة على صلاحيات service_role من جهة الخادم.

-- ==============================================================================
-- 8. دالة مساعدة لتوليد رمز QR مشفّر من الخادم (Server-side QR Token Generator)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.generate_server_qr(p_location_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_token TEXT;
    v_expires_at TIMESTAMPTZ;
BEGIN
    -- توليد رمز عشوائي آمن (UUID + أرقام عشوائية مشفرة)
    v_token := encode(gen_random_bytes(24), 'hex');
    -- الصلاحية 10 ثوانٍ مع إضافة 5 ثوانٍ سماحية تأخير شبكة
    v_expires_at := now() + interval '15 seconds';

    INSERT INTO public.qr_tokens (token, location_id, expires_at, used)
    VALUES (v_token, p_location_id, v_expires_at, false);

    -- تنظيف دوري للرموز المنتهية أقدم من 5 دقائق لتخفيف حجم الجدول
    DELETE FROM public.qr_tokens WHERE expires_at < (now() - interval '5 minutes');

    RETURN jsonb_build_object(
        'token', v_token,
        'expires_at', v_expires_at,
        'location_id', p_location_id
    );
END;
$$;

-- السماح للمدير المسجل باستدعاء دالة توليد الرمز
GRANT EXECUTE ON FUNCTION public.generate_server_qr(UUID) TO authenticated;

-- ==============================================================================
-- 9. بيانات افتراضية تجريبية (Demo Seed Data)
-- ==============================================================================
-- إضافة موقع عمل افتراضي (المقر الرئيسي)
INSERT INTO public.locations (id, name, lat, lng, radius_m)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'المقر الرئيسي (الرياض)',
    24.7136,
    46.6753,
    100
)
ON CONFLICT (id) DO NOTHING;

-- إضافة موظفين للتجربة
INSERT INTO public.employees (name, employee_code, department, is_active, device_status)
VALUES 
    ('أحمد المنصور', 'EMP101', 'تقنية المعلومات', true, 'none'),
    ('سارة العتيبي', 'EMP102', 'الموارد البشرية', true, 'none'),
    ('خالد الشمري', 'EMP103', 'العمليات والمشاريع', true, 'none')
ON CONFLICT (employee_code) DO NOTHING;


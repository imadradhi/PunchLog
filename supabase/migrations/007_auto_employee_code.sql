-- ==============================================================================
-- PUNCHLOG - التوليد التلقائي للرقم الوظيفي (4 أرقام)
-- ==============================================================================

-- 1. إنشاء تسلسل الأرقام الوظيفية من 4 أرقام يبدأ من 1001
CREATE SEQUENCE IF NOT EXISTS public.employee_code_seq
    START WITH 1001
    INCREMENT BY 1
    MINVALUE 1000
    MAXVALUE 9999;

-- ضبط بداية التسلسل بناءً على أعلى رقم موجود حالياً
DO $$
DECLARE
    v_max INT;
BEGIN
    SELECT coalesce(max(NULLIF(regexp_replace(employee_code, '\D', '', 'g'), '')::int), 1000)
    INTO v_max
    FROM public.employees;
    
    IF v_max >= 1000 AND v_max < 9999 THEN
        PERFORM setval('public.employee_code_seq', v_max + 1);
    END IF;
END $$;

-- 2. دالة المشغل لتوليد الرقم تلقائياً
CREATE OR REPLACE FUNCTION public.handle_auto_employee_code()
RETURNS TRIGGER AS $$
DECLARE
    v_new_code TEXT;
    v_exists BOOLEAN;
BEGIN
    -- إذا لم يتم تحديد رقم وظيفي، يتم توليده تلقائياً
    IF NEW.employee_code IS NULL OR trim(NEW.employee_code) = '' THEN
        LOOP
            v_new_code := nextval('public.employee_code_seq')::text;
            
            -- التحقق من عدم التكرار
            SELECT EXISTS(SELECT 1 FROM public.employees WHERE employee_code = v_new_code) INTO v_exists;
            IF NOT v_exists THEN
                NEW.employee_code := v_new_code;
                EXIT;
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. ربط المشغل بجدول الموظفين
DROP TRIGGER IF EXISTS trigger_auto_employee_code ON public.employees;
CREATE TRIGGER trigger_auto_employee_code
    BEFORE INSERT ON public.employees
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_auto_employee_code();

-- السماح بحقل employee_code بأن يُملأ تلقائياً بالمشغل
ALTER TABLE public.employees ALTER COLUMN employee_code DROP NOT NULL;

-- 4. تحديث أرقام الموظفين التجريبيين الحاليين لتكون 4 أرقام
UPDATE public.employees SET employee_code = '1001' WHERE employee_code = 'EMP101';
UPDATE public.employees SET employee_code = '1002' WHERE employee_code = 'EMP102';
UPDATE public.employees SET employee_code = '1003' WHERE employee_code = 'EMP103';


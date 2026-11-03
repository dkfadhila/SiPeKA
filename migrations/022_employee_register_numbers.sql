-- Public payroll register numbers; opaque staff identifiers remain internal.
CREATE SEQUENCE employee_register_number_seq;
ALTER TABLE operational_staff ADD COLUMN employee_code text;

WITH numbered AS (
 SELECT id,row_number() OVER(ORDER BY created_at,id) AS register_number
 FROM operational_staff
)
UPDATE operational_staff s
SET employee_code=lpad(numbered.register_number::text,3,'0')
FROM numbered
WHERE numbered.id=s.id;

SELECT setval(
 'employee_register_number_seq',
 greatest((SELECT count(*) FROM operational_staff),1),
 (SELECT count(*)>0 FROM operational_staff)
);

ALTER TABLE operational_staff
 ALTER COLUMN employee_code SET NOT NULL,
 ALTER COLUMN employee_code SET DEFAULT lpad(nextval('employee_register_number_seq')::text,3,'0');
ALTER TABLE operational_staff ADD CONSTRAINT operational_staff_employee_code_unique UNIQUE(employee_code);

DO $$
DECLARE schema_name text:=current_schema(); function_owner name;
BEGIN
 SELECT pg_get_userbyid(proowner) INTO function_owner
 FROM pg_proc WHERE oid='operational_directory(text,jsonb)'::regprocedure;
 EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %I.employee_register_number_seq TO %I',schema_name,function_owner);
END $$;

COMMENT ON COLUMN operational_staff.employee_code IS 'Stable public payroll register number; internal id remains the authorization key.';

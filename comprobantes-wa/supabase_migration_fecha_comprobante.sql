-- Ejecutar una vez en Supabase SQL Editor.
ALTER TABLE public.receipts
ADD COLUMN IF NOT EXISTS fecha_comprobante TEXT;

UPDATE public.receipts
SET fecha_comprobante = fecha
WHERE fecha_comprobante IS NULL AND fecha IS NOT NULL;

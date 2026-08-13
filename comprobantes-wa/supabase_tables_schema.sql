-- Copiar y pegar todo este bloque en el SQL Editor de tu nuevo proyecto Supabase

-- 1. Tabla de comprobantes (receipts)
CREATE TABLE IF NOT EXISTS public.receipts (
    id TEXT PRIMARY KEY,
    fecha TEXT,
    fecha_comprobante TEXT,
    hora TEXT,
    monto NUMERIC,
    moneda TEXT DEFAULT 'ARS',
    emisor TEXT,
    destinatario TEXT,
    local TEXT,
    tipo_comprobante TEXT,
    concepto TEXT,
    nro_operacion TEXT,
    sender TEXT,
    filename TEXT,
    "filePath" TEXT,
    "thumbnailBase64" TEXT,
    status TEXT DEFAULT 'completed',
    notas TEXT,
    "isDuplicate" BOOLEAN DEFAULT false,
    "repeatCount" INTEGER DEFAULT 1,
    "duplicateReason" TEXT,
    "rawText" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Índices para velocidad de consulta
CREATE INDEX IF NOT EXISTS idx_receipts_fecha ON public.receipts(fecha);
CREATE INDEX IF NOT EXISTS idx_receipts_fecha_comprobante ON public.receipts(fecha_comprobante);
CREATE INDEX IF NOT EXISTS idx_receipts_local ON public.receipts(local);
CREATE INDEX IF NOT EXISTS idx_receipts_nro_operacion ON public.receipts(nro_operacion);
CREATE INDEX IF NOT EXISTS idx_receipts_createdAt ON public.receipts("createdAt");

-- 2. Tabla de conciliaciones (reconciliations)
CREATE TABLE IF NOT EXISTS public.reconciliations (
    id TEXT PRIMARY KEY,
    name TEXT,
    "fileName" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    summary JSONB,
    data JSONB
);

-- 3. Tabla de autenticación WhatsApp (whatsapp_auth)
CREATE TABLE IF NOT EXISTS public.whatsapp_auth (
    id TEXT PRIMARY KEY,
    data JSONB,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

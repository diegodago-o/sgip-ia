-- ============================================================
-- Migración 003: Tasas de retención en schedule + vínculo pagos
-- Ejecutar en MySQL antes de hacer deploy del backend/frontend
-- ============================================================

-- 1. budget_income_schedule: columnas de tasas de retención
ALTER TABLE budget_income_schedule
  ADD COLUMN IF NOT EXISTS retefuente_pct DECIMAL(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reteica_pct    DECIMAL(5,3)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reteiva_pct    DECIMAL(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gmf_pct        DECIMAL(5,3)  NOT NULL DEFAULT 0;

-- 2. payments: vínculo al schedule + columnas GMF
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS schedule_id INT          NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gmf_pct     DECIMAL(5,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gmf_value   DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Índice para acelerar la consulta de hitos vinculados
CREATE INDEX IF NOT EXISTS idx_payments_schedule_id ON payments (schedule_id);

-- ============================================================
-- Migración 003: Tasas de retención en schedule + vínculo pagos
-- Compatible con MySQL 8.0
-- ============================================================

-- 1. budget_income_schedule: columnas de tasas de retención
ALTER TABLE budget_income_schedule
  ADD COLUMN retefuente_pct DECIMAL(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN reteica_pct    DECIMAL(5,3)  NOT NULL DEFAULT 0,
  ADD COLUMN reteiva_pct    DECIMAL(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN gmf_pct        DECIMAL(5,3)  NOT NULL DEFAULT 0;

-- 2. payments: vínculo al schedule + columnas GMF
ALTER TABLE payments
  ADD COLUMN schedule_id INT           NULL DEFAULT NULL,
  ADD COLUMN gmf_pct     DECIMAL(5,3)  NOT NULL DEFAULT 0,
  ADD COLUMN gmf_value   DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Índice para acelerar la consulta de hitos vinculados
CREATE INDEX idx_payments_schedule_id ON payments (schedule_id);

-- =============================================================================
--  SCRIPT DE VALIDACIÓN PMO — SGIP-IA
--  Replica exactamente las queries de biDashboard.js
--  Ejecutar en la BD de producción: mysql -u [user] -p[pass] sgip_ia < validacion_pmo.sql
--  O pegar directamente en MySQL Workbench / DBeaver
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 0 — RESUMEN DEL PORTAFOLIO
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '════════════ PORTAFOLIO ════════════' AS seccion;

SELECT
  COUNT(*)                                            AS total_proyectos,
  SUM(status = 'en_ejecucion')                        AS en_ejecucion,
  SUM(status = 'en_arranque')                         AS en_arranque,
  SUM(status = 'suspendido')                          AS suspendidos,
  SUM(status = 'cerrado')                             AS cerrados,
  ROUND(SUM(contract_value), 0)                       AS valor_total_contratos,
  ROUND(AVG(progress_pct), 1)                         AS avance_promedio_pct
FROM projects;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 1 — DATOS CRUDOS POR PROYECTO
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '════════════ PROYECTOS — DATOS BASE ════════════' AS seccion;

SELECT
  p.id,
  p.code,
  p.name,
  p.status,
  ROUND(p.contract_value, 0)                                              AS contract_value,
  p.progress_pct,
  p.start_date,
  p.execution_term,
  p.execution_term_unit,
  DATEDIFF(CURDATE(), p.start_date)                                       AS elapsed_days,
  CASE
    WHEN p.execution_term_unit IN ('dias_calendario','dias_habiles') THEN p.execution_term
    WHEN p.execution_term_unit = 'meses'  THEN p.execution_term * 30
    WHEN p.execution_term_unit = 'anos'   THEN p.execution_term * 365
    ELSE p.execution_term
  END                                                                      AS total_days_est,
  CASE
    WHEN p.execution_term_unit = 'anos'   THEN p.execution_term * 12
    WHEN p.execution_term_unit = 'meses'  THEN p.execution_term
    ELSE GREATEST(1, p.execution_term / 30)
  END                                                                      AS months_total
FROM projects p
ORDER BY p.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 2 — LÍNEA BASE: INGRESOS
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '════════════ LB — INGRESOS PLANIFICADOS ════════════' AS seccion;

-- Fuente primaria: budget_income_schedule (lo que usa el código)
SELECT
  p.id, p.code,
  ROUND(COALESCE(SUM(bis.valor_con_iva), 0), 0)   AS lb_income_schedule,  -- fuente primaria del código
  ROUND(p.contract_value, 0)                       AS contract_value,       -- fallback si schedule = 0
  CASE
    WHEN COALESCE(SUM(bis.valor_con_iva), 0) > 0
    THEN ROUND(COALESCE(SUM(bis.valor_con_iva), 0), 0)
    ELSE ROUND(p.contract_value, 0)
  END                                              AS lb_income_USADO        -- valor que usa el código
FROM projects p
LEFT JOIN budget_income_schedule bis ON bis.project_id = p.id
GROUP BY p.id, p.code, p.contract_value
ORDER BY p.id;

-- Detalle del schedule de ingresos por mes
SELECT '--- Detalle schedule ingresos ---' AS detalle;
SELECT
  p.code, bis.mes, bis.descripcion, bis.tipo_pago, bis.estado,
  ROUND(bis.valor_sin_iva, 0) AS sin_iva,
  ROUND(bis.valor_iva, 0)     AS iva,
  ROUND(bis.valor_con_iva, 0) AS con_iva,
  bis.fecha_estimada
FROM budget_income_schedule bis
JOIN projects p ON p.id = bis.project_id
ORDER BY p.id, bis.mes;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 3 — LÍNEA BASE: COSTOS
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '════════════ LB — COSTOS PLANIFICADOS ════════════' AS seccion;

SELECT
  p.id, p.code,
  ROUND(COALESCE(SUM(bp.costo_total), 0), 0)   AS payroll,
  ROUND(COALESCE(SUM(bc.costo_total), 0), 0)   AS contractors,
  ROUND(COALESCE(SUM(be.valor_total), 0), 0)   AS expenses,
  ROUND(
    COALESCE(SUM(bp.costo_total), 0) +
    COALESCE(SUM(bc.costo_total), 0) +
    COALESCE(SUM(be.valor_total), 0)
  , 0)                                          AS lb_costs_TOTAL
FROM projects p
LEFT JOIN budget_payroll     bp ON bp.project_id = p.id
LEFT JOIN budget_contractors bc ON bc.project_id = p.id
LEFT JOIN budget_expenses    be ON be.project_id = p.id
GROUP BY p.id, p.code
ORDER BY p.id;

-- Subtotales de costos por categoría
SELECT '--- Payroll detalle ---' AS detalle;
SELECT p.code, bp.cargo, bp.cantidad,
  ROUND(bp.costo_mensual, 0)  AS costo_mensual,
  bp.meses_vinculacion,
  ROUND(bp.costo_total, 0)    AS costo_total
FROM budget_payroll bp JOIN projects p ON p.id = bp.project_id
ORDER BY p.id, bp.cargo;

SELECT '--- Contractors detalle ---' AS detalle;
SELECT p.code, bc.cargo, bc.cantidad, bc.tipo_contrato,
  ROUND(bc.costo_mensual, 0)  AS costo_mensual,
  bc.meses_vinculacion,
  ROUND(bc.costo_total, 0)    AS costo_total
FROM budget_contractors bc JOIN projects p ON p.id = bc.project_id
ORDER BY p.id, bc.cargo;

SELECT '--- Expenses por categoría ---' AS detalle;
SELECT p.code, be.category,
  ROUND(SUM(be.valor_total), 0) AS subtotal_categoria
FROM budget_expenses be JOIN projects p ON p.id = be.project_id
GROUP BY p.id, p.code, be.category
ORDER BY p.id, subtotal_categoria DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 4 — SEGUIMIENTO: INGRESOS REALES
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '════════════ SEG — INGRESOS REALES (facturado + pagado) ════════════' AS seccion;

SELECT
  p.id, p.code,
  ROUND(SUM(CASE WHEN bis.estado = 'pagado'    THEN bis.valor_con_iva ELSE 0 END), 0) AS pagado,
  ROUND(SUM(CASE WHEN bis.estado = 'facturado' THEN bis.valor_con_iva ELSE 0 END), 0) AS facturado,
  ROUND(SUM(CASE WHEN bis.estado = 'pendiente' THEN bis.valor_con_iva ELSE 0 END), 0) AS pendiente,
  ROUND(SUM(CASE WHEN bis.estado IN ('pagado','facturado') THEN bis.valor_con_iva ELSE 0 END), 0) AS seg_income_REAL,
  -- Fallback si seg_income_real = 0: lb_income × avance%
  ROUND(
    CASE
      WHEN SUM(CASE WHEN bis.estado IN ('pagado','facturado') THEN bis.valor_con_iva ELSE 0 END) > 0
      THEN SUM(CASE WHEN bis.estado IN ('pagado','facturado') THEN bis.valor_con_iva ELSE 0 END)
      ELSE COALESCE(SUM(bis.valor_con_iva), p.contract_value) * p.progress_pct / 100
    END
  , 0)                                                                                  AS seg_income_USADO
FROM projects p
LEFT JOIN budget_income_schedule bis ON bis.project_id = p.id
GROUP BY p.id, p.code, p.contract_value, p.progress_pct
ORDER BY p.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 5 — SEGUIMIENTO: COSTOS REALES (budget_tracking)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '════════════ SEG — COSTOS REALES (budget_tracking) ════════════' AS seccion;

SELECT
  p.id, p.code,
  ROUND(SUM(CASE WHEN bt.fuente = 'payroll'     THEN bt.valor_ejecutado ELSE 0 END), 0)  AS ejecutado_payroll,
  ROUND(SUM(CASE WHEN bt.fuente = 'contractors' THEN bt.valor_ejecutado ELSE 0 END), 0)  AS ejecutado_contractors,
  ROUND(SUM(CASE WHEN bt.fuente = 'expenses'    THEN bt.valor_ejecutado ELSE 0 END), 0)  AS ejecutado_expenses,
  ROUND(SUM(CASE WHEN bt.fuente = 'puc'         THEN bt.valor_ejecutado ELSE 0 END), 0)  AS ejecutado_puc,
  ROUND(SUM(CASE WHEN bt.fuente = 'extra'       THEN bt.valor_ejecutado ELSE 0 END), 0)  AS ejecutado_extra,
  ROUND(COALESCE(SUM(bt.valor_ejecutado), 0), 0)                                          AS seg_costs_REAL,
  -- Fallback EV si no hay tracking: lb_costs × avance%
  ROUND(
    (SELECT COALESCE(SUM(bp.costo_total),0)+COALESCE(SUM(bc.costo_total),0)+COALESCE(SUM(be.valor_total),0)
     FROM budget_payroll bp, budget_contractors bc, budget_expenses be
     WHERE bp.project_id=p.id AND bc.project_id=p.id AND be.project_id=p.id)
    * p.progress_pct / 100
  , 0)                                                                                    AS fallback_EV,
  CASE WHEN COALESCE(SUM(bt.valor_ejecutado), 0) > 0 THEN 'budget_tracking (real)'
       ELSE 'Earned Value fallback' END                                                   AS fuente_usada
FROM projects p
LEFT JOIN budget_tracking bt ON bt.project_id = p.id
GROUP BY p.id, p.code, p.progress_pct
ORDER BY p.id;

-- Detalle de cobertura de budget_tracking
SELECT '--- Cobertura budget_tracking (fuentes con $0 ejecutado son problema) ---' AS detalle;
SELECT
  p.code,
  bt.fuente,
  COUNT(DISTINCT bt.mes)               AS meses_registrados,
  ROUND(SUM(bt.valor_planeado), 0)     AS total_planeado,
  ROUND(SUM(bt.valor_ejecutado), 0)    AS total_ejecutado,
  ROUND(
    CASE WHEN SUM(bt.valor_planeado) > 0
    THEN SUM(bt.valor_ejecutado) / SUM(bt.valor_planeado) * 100
    ELSE NULL END
  , 1)                                 AS pct_ejecucion
FROM budget_tracking bt
JOIN projects p ON p.id = bt.project_id
GROUP BY p.id, p.code, bt.fuente
ORDER BY p.id, bt.fuente;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 6 — SPI (Índice de Desempeño de Cronograma)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '════════════ SPI — CRONOGRAMA ════════════' AS seccion;

-- Fuente primaria: progress_records
SELECT '--- progress_records (fuente primaria SPI) ---' AS fuente;
SELECT
  p.code,
  pr.period_label, pr.period_date,
  pr.physical_planned  AS avance_planificado,
  pr.physical_actual   AS avance_real,
  CASE WHEN pr.physical_planned > 0
    THEN ROUND(pr.physical_actual / pr.physical_planned, 2)
    ELSE NULL
  END                  AS SPI_por_registro
FROM progress_records pr
JOIN projects p ON p.id = pr.project_id
WHERE pr.physical_planned > 0
ORDER BY p.id, pr.period_date;

-- Último registro (el que usa el código)
SELECT '--- Último progress_record con avance planificado > 0 ---' AS fuente;
SELECT
  p.id, p.code,
  pr.period_label, pr.period_date,
  pr.physical_planned, pr.physical_actual,
  ROUND(pr.physical_actual / pr.physical_planned, 2) AS SPI_desde_progress_records
FROM progress_records pr
JOIN projects p ON p.id = pr.project_id
WHERE pr.physical_planned > 0
  AND pr.period_date = (
    SELECT MAX(pr2.period_date) FROM progress_records pr2
    WHERE pr2.project_id = pr.project_id AND pr2.physical_planned > 0
  )
ORDER BY p.id;

-- Fallback temporal (usado cuando no hay progress_records)
SELECT '--- SPI fallback temporal (si no hay progress_records) ---' AS fuente;
SELECT
  p.id, p.code,
  p.progress_pct                                                                   AS avance_real_pct,
  ROUND(
    DATEDIFF(CURDATE(), p.start_date) /
    CASE
      WHEN p.execution_term_unit IN ('dias_calendario','dias_habiles') THEN p.execution_term
      WHEN p.execution_term_unit = 'meses' THEN p.execution_term * 30
      WHEN p.execution_term_unit = 'anos'  THEN p.execution_term * 365
      ELSE p.execution_term
    END * 100
  , 1)                                                                             AS avance_esperado_pct,
  ROUND(
    p.progress_pct /
    NULLIF(
      LEAST(100,
        DATEDIFF(CURDATE(), p.start_date) /
        CASE
          WHEN p.execution_term_unit IN ('dias_calendario','dias_habiles') THEN p.execution_term
          WHEN p.execution_term_unit = 'meses' THEN p.execution_term * 30
          WHEN p.execution_term_unit = 'anos'  THEN p.execution_term * 365
          ELSE p.execution_term
        END * 100
      ), 0
    )
  , 2)                                                                             AS SPI_fallback_temporal,
  DATEDIFF(CURDATE(), p.start_date)                                               AS elapsed_days,
  CASE
    WHEN p.execution_term_unit IN ('dias_calendario','dias_habiles') THEN p.execution_term
    WHEN p.execution_term_unit = 'meses' THEN p.execution_term * 30
    WHEN p.execution_term_unit = 'anos'  THEN p.execution_term * 365
    ELSE p.execution_term
  END                                                                              AS total_days
FROM projects p
ORDER BY p.id;

-- Schedule activities detail
SELECT '--- Schedule activities (base del SPI operativo) ---' AS fuente;
SELECT
  p.code,
  sa.activity_type,
  SUM(1)                                                                             AS total,
  SUM(sa.status = 'completada')                                                     AS completadas,
  SUM(sa.status = 'atrasada' OR
      (sa.end_date < CURDATE() AND sa.progress_pct < 100 AND sa.activity_type='task')) AS atrasadas,
  ROUND(AVG(CASE WHEN sa.activity_type='task' THEN sa.progress_pct END), 1)        AS avg_progress,
  ROUND(
    SUM(sa.status = 'atrasada' OR
        (sa.end_date < CURDATE() AND sa.progress_pct < 100 AND sa.activity_type='task'))
    / NULLIF(SUM(1), 0) * 100
  , 1)                                                                               AS pct_atrasadas
FROM schedule_activities sa
JOIN projects p ON p.id = sa.project_id
WHERE sa.activity_type = 'task'
GROUP BY p.id, p.code, sa.activity_type
ORDER BY p.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 7 — CPI (Índice de Desempeño de Costos)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '════════════ CPI — COSTOS ════════════' AS seccion;

SELECT
  p.id, p.code,
  p.progress_pct,
  -- EV = lb_costs × avance%
  ROUND(
    (COALESCE((SELECT SUM(bp.costo_total) FROM budget_payroll     bp WHERE bp.project_id = p.id), 0) +
     COALESCE((SELECT SUM(bc.costo_total) FROM budget_contractors bc WHERE bc.project_id = p.id), 0) +
     COALESCE((SELECT SUM(be.valor_total) FROM budget_expenses    be WHERE be.project_id = p.id), 0))
    * p.progress_pct / 100
  , 0)                                                                   AS EV_valor_ganado,
  -- AC = budget_tracking.valor_ejecutado (real)
  ROUND(COALESCE((SELECT SUM(bt.valor_ejecutado) FROM budget_tracking bt WHERE bt.project_id = p.id), 0), 0) AS AC_costo_real,
  -- CPI = EV / AC
  ROUND(
    (
      (COALESCE((SELECT SUM(bp.costo_total) FROM budget_payroll     bp WHERE bp.project_id = p.id), 0) +
       COALESCE((SELECT SUM(bc.costo_total) FROM budget_contractors bc WHERE bc.project_id = p.id), 0) +
       COALESCE((SELECT SUM(be.valor_total) FROM budget_expenses    be WHERE be.project_id = p.id), 0))
      * p.progress_pct / 100
    )
    / NULLIF(
        COALESCE((SELECT SUM(bt.valor_ejecutado) FROM budget_tracking bt WHERE bt.project_id = p.id), 0)
      , 0)
  , 2)                                                                   AS CPI_real,
  -- Fallback CPI (tiempo): EV / (lb_costs × elapsed_months/total_months)
  ROUND(
    (p.progress_pct / 100)
    /
    NULLIF(
      LEAST(1,
        DATEDIFF(CURDATE(), p.start_date) / 30
        /
        CASE
          WHEN p.execution_term_unit = 'anos'  THEN p.execution_term * 12
          WHEN p.execution_term_unit = 'meses' THEN p.execution_term
          ELSE GREATEST(1, p.execution_term / 30)
        END
      )
    , 0)
  , 2)                                                                   AS CPI_fallback_tiempo,
  CASE WHEN COALESCE((SELECT SUM(bt.valor_ejecutado) FROM budget_tracking bt WHERE bt.project_id=p.id),0) > 0
    THEN 'budget_tracking (real)'
    ELSE 'Fallback tiempo'
  END                                                                    AS fuente_cpi
FROM projects p
ORDER BY p.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 8 — RECAUDO VS CONTRATO
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '════════════ RECAUDO VS CONTRATO ════════════' AS seccion;

SELECT
  p.id, p.code,
  ROUND(p.contract_value, 0)                                                    AS contract_value,
  -- Pagos reales recibidos (payments WHERE status='pagado')
  ROUND(COALESCE(SUM(CASE WHEN pay.status='pagado' THEN pay.net_value ELSE 0 END), 0), 0)   AS pagos_recibidos_net,
  ROUND(COALESCE(SUM(CASE WHEN pay.status='pagado' THEN pay.gross_value ELSE 0 END), 0), 0) AS pagos_recibidos_bruto,
  -- Recaudo% = pagos_recibidos / contract_value × 100
  ROUND(
    COALESCE(SUM(CASE WHEN pay.status='pagado' THEN pay.net_value ELSE 0 END), 0)
    / NULLIF(p.contract_value, 0) * 100
  , 1)                                                                          AS recaudo_pct_NETO,
  ROUND(
    COALESCE(SUM(CASE WHEN pay.status='pagado' THEN pay.gross_value ELSE 0 END), 0)
    / NULLIF(p.contract_value, 0) * 100
  , 1)                                                                          AS recaudo_pct_BRUTO,
  -- Todos los estados para referencia
  COUNT(pay.id)                                                                 AS total_pagos_registrados,
  ROUND(COALESCE(SUM(pay.net_value), 0), 0)                                    AS total_todos_estados
FROM projects p
LEFT JOIN payments pay ON pay.project_id = p.id
GROUP BY p.id, p.code, p.contract_value
ORDER BY p.id;

-- Detalle de pagos
SELECT '--- Detalle de pagos por estado ---' AS detalle;
SELECT
  p.code,
  pay.status,
  COUNT(*)                          AS registros,
  ROUND(SUM(pay.gross_value), 0)    AS gross_value,
  ROUND(SUM(pay.net_value), 0)      AS net_value,
  ROUND(SUM(pay.retention_value), 0) AS retenciones,
  MIN(pay.invoice_date)             AS primera_factura,
  MAX(pay.paid_date)                AS ultimo_pago
FROM payments pay
JOIN projects p ON p.id = pay.project_id
GROUP BY p.id, p.code, pay.status
ORDER BY p.id, pay.status;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 9 — CÁLCULO CONSOLIDADO FINAL (lo que el dashboard DEBE mostrar)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '════════════ RESULTADO FINAL — COMPARAR CON DASHBOARD ════════════' AS seccion;

SELECT
  p.id, p.code, p.status,
  p.progress_pct,
  -- ── LÍNEA BASE ──
  ROUND(
    CASE WHEN COALESCE((SELECT SUM(bis.valor_con_iva) FROM budget_income_schedule bis WHERE bis.project_id=p.id),0) > 0
    THEN (SELECT SUM(bis.valor_con_iva) FROM budget_income_schedule bis WHERE bis.project_id=p.id)
    ELSE p.contract_value END
  ,0)                                                                              AS lb_income,
  ROUND(
    COALESCE((SELECT SUM(bp.costo_total) FROM budget_payroll     bp WHERE bp.project_id=p.id),0) +
    COALESCE((SELECT SUM(bc.costo_total) FROM budget_contractors bc WHERE bc.project_id=p.id),0) +
    COALESCE((SELECT SUM(be.valor_total) FROM budget_expenses    be WHERE be.project_id=p.id),0)
  ,0)                                                                              AS lb_costs,
  ROUND(
    (
      CASE WHEN COALESCE((SELECT SUM(bis.valor_con_iva) FROM budget_income_schedule bis WHERE bis.project_id=p.id),0) > 0
      THEN (SELECT SUM(bis.valor_con_iva) FROM budget_income_schedule bis WHERE bis.project_id=p.id)
      ELSE p.contract_value END
      -
      (COALESCE((SELECT SUM(bp.costo_total) FROM budget_payroll     bp WHERE bp.project_id=p.id),0) +
       COALESCE((SELECT SUM(bc.costo_total) FROM budget_contractors bc WHERE bc.project_id=p.id),0) +
       COALESCE((SELECT SUM(be.valor_total) FROM budget_expenses    be WHERE be.project_id=p.id),0))
    )
    /
    NULLIF(
      CASE WHEN COALESCE((SELECT SUM(bis.valor_con_iva) FROM budget_income_schedule bis WHERE bis.project_id=p.id),0) > 0
      THEN (SELECT SUM(bis.valor_con_iva) FROM budget_income_schedule bis WHERE bis.project_id=p.id)
      ELSE p.contract_value END
    , 0) * 100
  ,1)                                                                              AS lb_rentabilidad_pct,
  -- ── SEGUIMIENTO ──
  ROUND(
    COALESCE(
      (SELECT SUM(bis2.valor_con_iva) FROM budget_income_schedule bis2
       WHERE bis2.project_id=p.id AND bis2.estado IN ('pagado','facturado')), 0)
  ,0)                                                                              AS seg_income,
  ROUND(
    COALESCE((SELECT SUM(bt.valor_ejecutado) FROM budget_tracking bt WHERE bt.project_id=p.id), 0)
  ,0)                                                                              AS seg_costs_real,
  ROUND(
    COALESCE(
      (SELECT SUM(bis2.valor_con_iva) FROM budget_income_schedule bis2
       WHERE bis2.project_id=p.id AND bis2.estado IN ('pagado','facturado')), 0)
    -
    COALESCE((SELECT SUM(bt.valor_ejecutado) FROM budget_tracking bt WHERE bt.project_id=p.id), 0)
  ,0)                                                                              AS seg_utilidad,
  ROUND(
    (COALESCE((SELECT SUM(bis2.valor_con_iva) FROM budget_income_schedule bis2
               WHERE bis2.project_id=p.id AND bis2.estado IN ('pagado','facturado')), 0)
     -
     COALESCE((SELECT SUM(bt.valor_ejecutado) FROM budget_tracking bt WHERE bt.project_id=p.id), 0))
    /
    NULLIF(COALESCE((SELECT SUM(bis2.valor_con_iva) FROM budget_income_schedule bis2
                     WHERE bis2.project_id=p.id AND bis2.estado IN ('pagado','facturado')), 0), 0)
    * 100
  ,1)                                                                              AS seg_rentabilidad_pct,
  -- ── OPERATIVO ──
  ROUND(
    p.progress_pct /
    NULLIF(
      LEAST(100,
        DATEDIFF(CURDATE(), p.start_date) /
        CASE
          WHEN p.execution_term_unit IN ('dias_calendario','dias_habiles') THEN p.execution_term
          WHEN p.execution_term_unit = 'meses' THEN p.execution_term * 30
          WHEN p.execution_term_unit = 'anos'  THEN p.execution_term * 365
          ELSE p.execution_term
        END * 100
      ), 0)
  ,2)                                                                              AS SPI,
  ROUND(
    (
      (COALESCE((SELECT SUM(bp2.costo_total) FROM budget_payroll     bp2 WHERE bp2.project_id=p.id),0) +
       COALESCE((SELECT SUM(bc2.costo_total) FROM budget_contractors bc2 WHERE bc2.project_id=p.id),0) +
       COALESCE((SELECT SUM(be2.valor_total) FROM budget_expenses    be2 WHERE be2.project_id=p.id),0))
      * p.progress_pct / 100
    )
    / NULLIF(COALESCE((SELECT SUM(bt2.valor_ejecutado) FROM budget_tracking bt2 WHERE bt2.project_id=p.id),0), 0)
  ,2)                                                                              AS CPI,
  ROUND(
    COALESCE((SELECT SUM(pay.net_value) FROM payments pay WHERE pay.project_id=p.id AND pay.status='pagado'),0)
    / NULLIF(p.contract_value, 0) * 100
  ,1)                                                                              AS recaudo_pct,
  -- ── RAG ──
  CASE
    WHEN p.status = 'suspendido' THEN 'ROJO (suspendido)'
    WHEN (
      p.progress_pct /
      NULLIF(LEAST(100, DATEDIFF(CURDATE(),p.start_date) /
        CASE WHEN p.execution_term_unit IN ('dias_calendario','dias_habiles') THEN p.execution_term
             WHEN p.execution_term_unit='meses' THEN p.execution_term*30
             WHEN p.execution_term_unit='anos'  THEN p.execution_term*365
             ELSE p.execution_term END * 100), 0)
    ) < 0.80 THEN 'ROJO (SPI < 0.80)'
    WHEN (
      p.progress_pct /
      NULLIF(LEAST(100, DATEDIFF(CURDATE(),p.start_date) /
        CASE WHEN p.execution_term_unit IN ('dias_calendario','dias_habiles') THEN p.execution_term
             WHEN p.execution_term_unit='meses' THEN p.execution_term*30
             WHEN p.execution_term_unit='anos'  THEN p.execution_term*365
             ELSE p.execution_term END * 100), 0)
    ) < 0.95 THEN 'AMARILLO (SPI 0.80-0.95)'
    ELSE 'VERDE (SPI >= 0.95)'
  END                                                                              AS RAG_status
FROM projects p
ORDER BY p.id;

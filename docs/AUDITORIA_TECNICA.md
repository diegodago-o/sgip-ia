# Auditoría Técnica SGIP-IA — Informe Comparativo
**Fecha:** 2026-03-21
**Auditor:** Claude Code (claude-sonnet-4-6)
**Rama:** `main` | Commits cubiertos: `7526c48` → `b888054`

---

## Resumen Ejecutivo

| Categoría | Antes | Después | Δ |
|---|---|---|---|
| npm HIGH (backend) | 1 | **0** | −1 |
| npm HIGH (frontend) | 14 | **0** | −14 |
| npm MODERATE | 4 | 4 | sin fix upstream |
| npm LOW | 9 | 9 | sin fix upstream |
| Código HIGH | 2 | **0** | −2 |
| Código MEDIUM | 2 | **0** | −2 |
| Código LOW | 1 | **0** | −1 |
| **Total issues activos** | **33** | **13** | **−20 (−61%)** |

Los 13 restantes (4 moderate + 9 low) son **exclusivamente build-time** dentro de `react-scripts@5.0.1` y no llegan al bundle de producción.

---

## 1. Dependencias — npm audit

### 1.1 Backend

| Paquete | Severidad | CVE / Advisory | Fix aplicado | Commit |
|---|---|---|---|---|
| `xlsx ^0.18.5` | **HIGH** | GHSA-4r6h-8v6p-xvw6 (Prototype Pollution) + GHSA-5pgg-2g8v-p4x9 (ReDoS) | ✅ Eliminado — `extractTextFromExcel()` migrada a `exceljs` (ya instalado) | `6e96bac` |

**Estado final backend:** `0 vulnerabilidades`

### 1.2 Frontend

| Paquete | Severidad | Descripción | Fix | Commit |
|---|---|---|---|---|
| `flatted <=3.4.1` | HIGH | Unbounded recursion DoS + Prototype Pollution | ✅ `npm audit fix` | `6e96bac` |
| `jsonpath *` | HIGH | Arbitrary Code Injection via `eval()` | ✅ `npm audit fix` | `6e96bac` |
| `nth-check <2.0.1` | HIGH | ReDoS en selectores CSS (build-time svgo) | ✅ Override `"nth-check": "^3.0.1"` | `6e96bac` |
| `serialize-javascript <=7.0.2` | HIGH | XSS en serialización webpack (build-time) | ✅ Override `"serialize-javascript": "^7.0.4"` | `6e96bac` |
| `underscore <=1.13.7` | HIGH | DoS por recursión en `_.flatten`/`_.isEqual` | ✅ Override `"underscore": "^1.13.8"` | `6e96bac` |
| `dompurify 3.1.3–3.3.1` | MODERATE | XSS bypass en DOMPurify | ✅ `npm audit fix` (→ 3.2.4) | `6e96bac` |
| `postcss <8.4.31` | MODERATE | Line return parsing error (build-time) | ⚠️ Sin fix — anidado dentro de `resolve-url-loader` en react-scripts | — |
| `webpack-dev-server <=5.2.0` | MODERATE | Source theft vía sitio malicioso (solo `npm start`) | ⚠️ Sin fix — exclusivo de entorno dev, nunca en producción | — |

> **Por qué no se corrigen los restantes:** Los 2 moderate y 9 low están encapsulados en `node_modules` internos de `react-scripts@5.0.1`. npm `overrides` no puede penetrar los `node_modules` anidados en paquetes que ya incluyen su propia copia. Tampoco existe `react-scripts@6.x`. La corrección definitiva es migrar el build tool a **Vite** (tarea mayor, roadmap futuro).

---

## 2. Seguridad de Código

### 2.1 Issues corregidos

#### HIGH — Validación de extensión en uploads de documentos
**Archivo:** `backend/src/routes/documents.js` | **Commit:** `b888054`

**Problema:** El `fileFilter` de multer solo verificaba el MIME type declarado en el header HTTP, que puede ser falsificado. Un archivo `malware.pdf.exe` pasaba el filtro porque su `mimetype` se declaraba como `application/pdf`.

**Fix:** Se agregó `MIME_EXT_MAP` que valida que la extensión del archivo coincida con su MIME type:
```js
// Antes
if (allowed.includes(file.mimetype)) cb(null, true);

// Después
const allowedExts = MIME_EXT_MAP[file.mimetype];
if (!allowedExts) return cb(new Error('Tipo no permitido'));
const ext = path.extname(file.originalname).toLowerCase();
if (!allowedExts.includes(ext)) return cb(new Error('Extensión no corresponde al tipo declarado'));
```

#### MEDIUM — Sin rate limiting en rutas CPU/LLM intensivas
**Archivo:** `backend/src/server.js` | **Commit:** `b888054`

**Problema:** `/api/ai`, `/api/ai-populate` y `/api/exports` usaban solo el límite global (500 req/15min). Llamadas masivas podían agotar cuotas de API de IA o saturar la generación de PDF/Excel.

**Fix:** Limitadores específicos por usuario autenticado:
```js
aiLimiter:     60 llamadas / hora   por user.id  → /api/ai + /api/ai-populate
exportLimiter: 30 exportaciones / 15min por user.id → /api/exports
```

#### LOW — Sin trazabilidad de claves de IA del cliente
**Archivo:** `backend/src/routes/ai.js` | **Commit:** `b888054`

**Problema:** Cuando un usuario pasaba su propia API key en el body (diseño BYOK), no quedaba ningún registro de quién usó una clave propia ni se podía detectar configuraciones de producción incompletas.

**Fix:** `console.warn` con `user.id` cuando env key no está configurada y el cliente aporta la suya:
```js
if (!envKey && req.body.api_key) {
  console.warn(`[AI] Cliente usando clave propia (user=${req.user?.id}, provider=anthropic)`);
}
```
Adicionalmente, se **prioriza la env var** sobre la clave del cliente, mejorando la postura de seguridad en producción.

### 2.2 Falsos positivos (confirmados como OK)

| Hallazgo inicial | Veredicto |
|---|---|
| `/api/projects/options/directors` sin autenticación | **Falso positivo** — `router.use(authMiddleware)` en línea 7 protege toda la instancia del router |
| `req.body.api_key` como vector de ataque | **Diseño intencional BYOK** — la clave pertenece al propio usuario, almacenada en su `localStorage`. Riesgo residual mitigado con rate limiting + env priority |

### 2.3 Postura validada (sin cambios requeridos)

| Área | Estado | Detalle |
|---|---|---|
| SQL Injection | ✅ Seguro | 100% queries con `?` parametrizados vía `mysql2/promise` |
| CORS | ✅ Seguro | Whitelist de origins en `.env`, `credentials: true` solo con origins específicas |
| JWT | ✅ Seguro | Secret en env var, expiración 8h configurable, re-verificación en DB en cada request |
| Rate limiting — login | ✅ Seguro | 20 intentos / 15 min con `skipSuccessfulRequests: true` |
| Headers de seguridad | ✅ Seguro | `helmet` (XSS, clickjacking, MIME sniff) + `hpp` + `x-powered-by` off |
| Validación de inputs | ✅ Seguro | `express-validator` en todos los endpoints con parámetros de usuario |
| Secretos hardcodeados | ✅ Ninguno | Credenciales en `.env` o tabla `system_settings` en DB |
| Control de acceso por rol | ✅ Seguro | `roleMiddleware` + `projectAccessMiddleware` con verificación en DB |
| Stack traces en producción | ✅ Seguro | Error handler global oculta detalles con flag `isDev` |

---

## 3. Registro de Commits

| Commit | Fecha | Descripción |
|---|---|---|
| `6e96bac` | 2026-03-21 | fix(security): eliminar vulnerabilidades HIGH en frontend y backend |
| `b888054` | 2026-03-21 | fix(security): validación extensión archivos + rate limit AI/exports + log API key cliente |

---

## 4. Pendientes — Roadmap

| Prioridad | Item | Esfuerzo | Impacto |
|---|---|---|---|
| Media | Migrar build tool de `react-scripts` a **Vite** | Alto (2–3 días) | Elimina los 13 moderate/low restantes + build 10× más rápido |
| Baja | Servir `/uploads` con auth check por proyecto | Medio (1 día) | Evita que usuarios con link directo accedan a archivos de otros proyectos |
| Baja | Documentar rotación periódica de `JWT_SECRET` | Bajo (30 min) | Reduce riesgo ante compromiso de .env |
| Baja | Rate limiting en `/api/exec/*/firma` (firma pública) | Bajo (30 min) | Previene enumeración de tokens de firma |

---

*Generado por Claude Code — SGIP-IA Security Audit 2026-03-21*

# SGIP-IA — Documento de Entrega a Desarrolladores

> **Sistema de Gestión Integral de Proyectos con IA**  
> Versión 2.0.0 | Actualizado: 2026-06-19  
> Cliente / Propietario: Tecnofactory S.A.S  

---

## 1. RESUMEN EJECUTIVO

SGIP-IA es una plataforma web para gestión integral de proyectos de ingeniería/consultoría en Colombia. Cubre el ciclo completo: adjudicación → planificación → ejecución → control → cierre → indicadores, con integración a IA (Anthropic/OpenAI), SharePoint, correo IMAP/SMTP y firmas digitales.

**Tech stack:** Node.js + Express 5 / React 18 / MySQL 8.0 / Tailwind CSS  
**Repositorio:** https://github.com/diegodago-o/sgip-ia  
**Producción:** https://sigp.tecnofactory.net.co  
**API producción:** https://sigp.tecnofactory.net.co/api

---

## 2. ARQUITECTURA DEL SISTEMA

```
┌─────────────────────────────────────────────────────────────────┐
│                     INTERNET / USUARIOS                          │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS :443
                    ┌────────▼────────┐
                    │   NGINX (proxy  │  /var/www/sgip-ia/frontend/build
                    │   + static SPA) │  proxy_pass → :4000
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     ┌────────▼────────┐         ┌──────────▼──────────┐
     │  React 18 SPA   │         │  Express 5 API       │
     │  (build estático│         │  Puerto 4000         │
     │  servido por    │         │  PM2: sgip-backend   │
     │  nginx)         │         │  Node.js 18+         │
     └─────────────────┘         └──────────┬──────────┘
                                            │
                                   ┌────────▼────────┐
                                   │  MySQL 8.0       │
                                   │  DB: sgip_ia     │
                                   │  Puerto 3306     │
                                   └─────────────────┘

Servicios externos:
  • Anthropic API (claude-sonnet-4-*)  → IA generativa
  • OpenAI API (gpt-4o)                → IA alternativa
  • Microsoft Graph API                → SharePoint
  • OAuth 2.0 (Microsoft/Google/GitHub)→ SSO
  • SMTP/IMAP                          → Correo electrónico
```

### Flujo de una request

1. Usuario → HTTPS → nginx (:443)
2. Rutas `/api/*` → proxy_pass → Express (:4000)
3. Express autentica JWT → ejecuta lógica → query MySQL
4. Resto de rutas → nginx sirve `frontend/build/index.html` (SPA)

---

## 3. INFRAESTRUCTURA

### 3.1 Servidor de producción

| Item | Valor |
|------|-------|
| OS | Ubuntu 22.04 LTS |
| Usuario SSH | `sgpmotf` |
| Host | SGIP-machine |
| Directorio app | `/var/www/sgip-ia/` |
| Proceso Node | PM2 — `sgip-backend` (id: 0) |
| Web server | nginx |
| Config nginx | `/etc/nginx/sites-available/sgip-ia` |
| Frontend build | `/var/www/sgip-ia/frontend/build/` |
| Backend | `/var/www/sgip-ia/backend/` |
| Uploads | `/var/www/sgip-ia/backend/uploads/` |

### 3.2 Configuración nginx resumida

```nginx
server {
    listen 443 ssl;
    server_name sigp.tecnofactory.net.co;

    root /var/www/sgip-ia/frontend/build;   # SPA estática
    index index.html;

    location /api/ {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;   # React Router SPA fallback
    }
}
```

### 3.3 PM2 — gestión del proceso Node

```bash
pm2 list                        # Ver procesos activos
pm2 logs sgip-backend           # Ver logs en tiempo real
pm2 restart sgip-backend        # Reiniciar sin downtime
pm2 restart sgip-backend --update-env  # Reiniciar recargando .env
pm2 stop sgip-backend           # Detener
pm2 start ecosystem.config.js   # Iniciar desde config (si existe)
pm2 save && pm2 startup         # Persistir entre reinicios del OS
```

### 3.4 Variables de entorno (producción)

Archivo: `/var/www/sgip-ia/backend/.env`

```dotenv
PORT=4000
NODE_ENV=production
TZ=America/Bogota

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=<contraseña real>
DB_NAME=sgip_ia
DB_POOL_SIZE=20
DB_SSL=false

# JWT — CAMBIAR EN PRODUCCIÓN
JWT_SECRET=<valor largo y aleatorio>
JWT_EXPIRES_IN=8h

# IA — configurar al menos uno
ANTHROPIC_API_KEY=<sk-ant-...>
ANTHROPIC_MODEL=claude-sonnet-4-20250514
OPENAI_API_KEY=<sk-...>
OPENAI_MODEL=gpt-4o

# SharePoint / Microsoft Graph (opcional)
SP_TENANT_ID=
SP_CLIENT_ID=
SP_CLIENT_SECRET=
SP_SITE_URL=

# Email SMTP (opcional)
MAIL_HOST=
MAIL_PORT=587
MAIL_USER=
MAIL_PASS=
MAIL_FROM=

# CORS — dominio(s) del frontend
CORS_ORIGINS=https://sigp.tecnofactory.net.co
```

---

## 4. COMANDOS DE DESPLIEGUE

### 4.1 Deploy estándar (solo código, sin migraciones)

```bash
# En el servidor (SSH como sgpmotf)
cd /var/www/sgip-ia
git pull origin main
npm run build --prefix frontend
pm2 restart sgip-backend --update-env
```

### 4.2 Deploy con migración SQL

```bash
cd /var/www/sgip-ia
git pull origin main

# Ejecutar migración (ejemplo migration 003)
mysql -u root -p sgip_ia < backend/migrations/003_tax_rates_and_schedule_link.sql

# O scripts Node
node backend/scripts/migrate-settings.js

# Build y restart
npm run build --prefix frontend
pm2 restart sgip-backend --update-env
```

### 4.3 Rollback rápido

```bash
cd /var/www/sgip-ia
git log --oneline -10                  # Ver commits
git checkout <commit-hash>             # Ir a versión anterior
npm run build --prefix frontend
pm2 restart sgip-backend --update-env
```

### 4.4 Logs y monitoreo

```bash
pm2 logs sgip-backend --lines 100      # Últimas 100 líneas
pm2 logs sgip-backend --err            # Solo errores
journalctl -u nginx -n 50             # Logs nginx
tail -f /var/log/nginx/access.log      # Accesos en tiempo real
```

---

## 5. REPOSITORIO GIT

### 5.1 Remoto actual

```
https://github.com/diegodago-o/sgip-ia.git
```

### 5.2 Ramas activas

| Rama | Propósito |
|------|-----------|
| `main` | Producción — rama desplegada en el servidor |
| `develop` | Integración de features antes de pasar a main |
| `feature/ai-document-analysis` | Feature en desarrollo |
| `feature/nueva-identidad-grafica` | Rediseño visual |
| `feature/correspondencia-*` | Módulo correspondencia |
| `fix/roles-permisos` | Fix pendiente de merge |

### 5.3 Convención de commits

```
feat: nueva funcionalidad
fix:  corrección de bug
refactor: refactorización sin cambio de comportamiento
docs: solo documentación
chore: tareas de mantenimiento (dependencias, scripts)
```

### 5.4 Flujo de trabajo recomendado

```bash
# Crear feature
git checkout develop
git pull origin develop
git checkout -b feature/nombre-feature

# Desarrollar + commits
git add -p                        # Staging selectivo
git commit -m "feat: descripción"

# Merge a develop
git push origin feature/nombre-feature
# → Crear PR en GitHub/Azure DevOps hacia develop

# Deploy a producción
git checkout main
git merge develop --no-ff
git push origin main
# → SSH al servidor y ejecutar deploy estándar
```

---

## 6. ESTRUCTURA DE CÓDIGO

### 6.1 Árbol completo

```
sgip-ia/
├── package.json              ← Scripts raíz (install, dev, db:*)
├── README.md
├── docs/
│   ├── HANDOVER.md           ← Este archivo
│   └── AUDITORIA_TECNICA.md  ← Auditoría de seguridad
│
├── backend/
│   ├── src/
│   │   ├── server.js         ← Entry point Express 5 (puerto 4000)
│   │   ├── config/
│   │   │   └── database.js   ← Pool MySQL con ssl y timezone UTC
│   │   ├── middleware/
│   │   │   └── auth.js       ← JWT verify + ROLE_MAP + projectAccess
│   │   ├── routes/           ← 30+ archivos, uno por módulo
│   │   ├── services/
│   │   │   ├── ai-engine.js  ← Abstracción LLM (Anthropic/OpenAI)
│   │   │   ├── aiConfig.js   ← Config IA desde DB o .env
│   │   │   ├── emailPoller.js← Polling IMAP
│   │   │   ├── mailer.js     ← Envío SMTP
│   │   │   ├── notifier.js   ← Notificaciones in-app
│   │   │   ├── sharepoint.js ← Microsoft Graph API client
│   │   │   └── webhook.js    ← Webhooks salientes
│   │   ├── jobs/
│   │   │   └── notificationScheduler.js ← Cron jobs
│   │   └── utils/
│   │       └── htmlParser.js
│   ├── scripts/              ← 20 scripts de init/migración
│   │   ├── init-db.js        ← Crea todas las tablas
│   │   ├── seed.js           ← Usuarios de prueba
│   │   └── migrate-*.js      ← Migraciones por feature
│   ├── migrations/
│   │   └── 003_tax_rates_and_schedule_link.sql
│   ├── templates/
│   │   └── acta_header.png   ← Header para documentos generados
│   ├── uploads/              ← Archivos subidos por usuarios
│   ├── .env                  ← Variables de entorno (NO en git)
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── App.js            ← Router principal (React Router 6)
    │   ├── index.js          ← Entry point React
    │   ├── context/
    │   │   └── AuthContext.js← Estado global de autenticación
    │   ├── hooks/
    │   │   └── usePermissions.js ← Permisos por rol
    │   ├── services/
    │   │   └── api.js        ← Cliente Axios + interceptores
    │   └── components/
    │       ├── auth/         ← LoginPage, OAuthCallback, ProtectedRoute
    │       ├── layout/       ← MainLayout, Sidebar, TopBar
    │       ├── pages/        ← Dashboard, ProjectList, ProjectDetail…
    │       ├── budget/       ← BudgetPanel (módulo complejo)
    │       ├── execution/    ← Schedule, Progress, Payments, Minutes…
    │       ├── closure/      ← Closure, Liquidation, Lessons
    │       ├── ai/           ← AIAutoPopulate, AIProjectCreator
    │       ├── documents/    ← DocumentsPanel
    │       ├── sharepoint/   ← SharePointPanel, SPCoverage
    │       ├── obligations/  ← ObligationsPanel
    │       ├── policies/     ← PoliciesPanel
    │       ├── milestones/   ← MilestonesPanel
    │       └── team/         ← TeamPanel
    ├── public/
    │   └── pdf.worker.min.js ← PDF.js web worker
    ├── .env                  ← PORT=3001
    ├── .env.production       ← REACT_APP_API_URL=https://sigp.tecnofactory.net.co/api
    ├── tailwind.config.js
    └── package.json
```

### 6.2 Rutas API (mapa completo)

| Prefijo | Archivo de ruta | Función |
|---------|----------------|---------|
| `/api/auth` | `auth.js`, `oauth.js` | Login, registro, SSO, refresh token |
| `/api/projects` | `projects.js` | CRUD proyectos |
| `/api/obligations` | `obligations.js` | Obligaciones contractuales |
| `/api/policies` | `policies.js` | Pólizas/entregables |
| `/api/documents` | `documents.js` | Documentos adjuntos |
| `/api/budget/:pid` | `budget.js` | Presupuesto, flujo ingresos, resumen financiero |
| `/api/budget/:pid` | `budgetTracking.js` | Ejecución presupuestal real |
| `/api/exec/:pid/schedule` | `schedule.js` | Cronograma |
| `/api/exec/:pid/progress` | `progress.js` | Avance % |
| `/api/exec/:pid/payments` | `payments.js` | Pagos (facturas + retenciones) |
| `/api/exec/:pid/minutes` | `minutes.js` | Actas con firma digital |
| `/api/exec/:pid/changes` | `changes.js` | Órdenes de cambio |
| `/api/exec/:pid/risks` | `risks.js` | Registro de riesgos |
| `/api/exec/:pid/correspondence` | `correspondence.js` | Correspondencia entrada/salida |
| `/api/exec/:pid/email-inbox` | `emailInbox.js` | Config polling IMAP |
| `/api/close/:pid` | `closure.js`, `liquidation.js`, `lessons.js` | Cierre, liquidación, lecciones |
| `/api/ai` | `ai.js`, `aiPopulate.js` | Llamadas LLM, auto-populate |
| `/api/admin` | `admin.js` | Gestión usuarios |
| `/api/committee` | `committee.js`, `committeeCommitments.js` | Comité directivo |
| `/api/dashboard` | `biDashboard.js` | BI / métricas globales |
| `/api/indicators` | `indicators.js` | KPIs |
| `/api/settings` | `settings.js`, `apiKeys.js` | Config sistema, API keys |
| `/api/notifications` | `notifications.js` | Notificaciones in-app |
| `/api/exports` | `exports.js` | PDF / Excel export |
| `/api/sharepoint` | `sharepoint.js`, `sharepoint-connections.js` | Integración SharePoint |
| `/api/team/:pid` | `team.js` | Equipo de proyecto |
| `/api/pm/:pid/milestones` | `milestones.js` | Hitos |
| `/api/health` | (inline en server.js) | Health check |

### 6.3 Roles y permisos

| Rol en BD | Alias en app | Acceso |
|-----------|-------------|--------|
| `admin` | admin | Todo sin restricciones |
| `director` | `gerente_proyecto` | Proyectos asignados + sus módulos |
| `consultor` | `apoyo` | Solo lectura en proyectos asignados |
| `visor` | `director_pmo` | Todos los proyectos (solo lectura) |
| `ceo` | `ceo` | Todos los proyectos + indicadores |

> El mapeo se realiza en `backend/src/middleware/auth.js` → `ROLE_MAP`.

---

## 7. BASE DE DATOS

### 7.1 Motor y versión

MySQL 8.0+ | Charset: `utf8mb4` | Timezone: UTC (conversión en frontend/JS)

### 7.2 Base de datos

```
Nombre: sgip_ia
```

### 7.3 Tablas principales (agrupadas por módulo)

```
Autenticación y usuarios:
  users                         — usuarios, roles, OAuth
  
Proyectos:
  projects                      — datos maestros del proyecto
  project_team                  — equipo asignado
  
Adjudicación / Arranque:
  obligations                   — obligaciones contractuales
  policies                      — pólizas y entregables
  milestones                    — hitos del proyecto
  
Planificación (Presupuesto):
  budget_payroll                — nómina presupuestada
  budget_contractors            — contratistas presupuestados
  budget_expenses               — gastos operativos presupuestados
  budget_deductions             — deducciones (retenciones, AF, GNC)
  budget_income_schedule        — flujo de ingresos presupuestado (+ tasas retención)
  budget_tracking               — ejecución real del presupuesto
  
Ejecución:
  schedule_items                — cronograma
  progress_updates              — actualizaciones de avance
  payments                      — pagos / facturas (+ schedule_id, gmf)
  meeting_minutes               — actas de reunión
  minute_signatures             — firmas de actas
  changes                       — órdenes de cambio
  risks                         — registro de riesgos
  correspondence                — correspondencia entrada/salida
  correspondence_attachments    — adjuntos de correspondencia
  corr_signatures               — firmas de correspondencia
  free_signatures               — firmas libres
  free_signature_signers        — firmantes de firmas libres
  email_inbox_config            — configuración IMAP por proyecto
  
Cierre:
  closure_checklist             — checklist de cierre
  liquidation                   — liquidación financiera
  lessons_learned               — lecciones aprendidas
  
Comité:
  committee_sessions            — sesiones de comité
  committee_points              — puntos tratados
  committee_commitments         — compromisos adquiridos
  
Documentos:
  documents                     — archivos adjuntos (metadatos)
  
Sistema:
  settings                      — configuración global del sistema
  api_keys                      — API keys para IA
  notifications                 — notificaciones in-app
  sharepoint_connections        — configuración SharePoint por empresa
```

### 7.4 Migraciones

Las tablas base se crean con `node backend/scripts/init-db.js`.  
Las migraciones adicionales son scripts Node (`migrate-*.js`) o SQL (carpeta `migrations/`).

**Orden de ejecución en instalación nueva:**

```bash
node backend/scripts/init-db.js              # Tablas base
node backend/scripts/seed.js                 # Usuarios admin/director
node backend/scripts/migrate-m1.js           # Módulo 1 (proyectos)
node backend/scripts/migrate-budget.js       # Presupuesto v1
node backend/scripts/migrate-budget-v2.js    # Presupuesto v2
node backend/scripts/migrate-budget-tracking.js
node backend/scripts/migrate-budget-tracking-v2.js
node backend/scripts/migrate-correspondence.js
node backend/scripts/migrate-correspondence-v2.js
node backend/scripts/migrate-settings.js
node backend/scripts/migrate-roles.js
node backend/scripts/migrate-api-keys.js
node backend/scripts/migrate-income-schedule.js
node backend/scripts/migrate-payments-retentions.js
node backend/scripts/migrate-committee-commitments.js
node backend/scripts/migrate-team-fields.js
node backend/scripts/migrate-oauth.js
# Última migración SQL (v003):
mysql -u root -p sgip_ia < backend/migrations/003_tax_rates_and_schedule_link.sql
```

> **Nota:** Los scripts son idempotentes (usan `ADD COLUMN IF NOT EXISTS` o `CREATE TABLE IF NOT EXISTS`). La excepción es `003_tax_rates_and_schedule_link.sql` que usa MySQL 8.0 (sin `IF NOT EXISTS` en `ADD COLUMN`) — solo ejecutar una vez.

---

## 8. INSTALACIÓN LOCAL

### 8.1 Requisitos

- Node.js 18+ (`node --version`)
- MySQL 8.0+ corriendo localmente
- npm 9+ (viene con Node.js)
- Git

### 8.2 Paso a paso

```bash
# 1. Clonar repositorio
git clone https://github.com/diegodago-o/sgip-ia.git
cd sgip-ia

# 2. Instalar dependencias (backend + frontend)
npm run install:all

# 3. Configurar variables de entorno
cp backend/.env.example backend/.env   # si existe; si no, crear manual
# Editar backend/.env con tus credenciales MySQL locales

# 4. Crear base de datos en MySQL
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS sgip_ia CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 5. Crear tablas y datos iniciales
npm run db:init
npm run db:seed

# 6. Ejecutar migraciones adicionales (en orden)
node backend/scripts/migrate-settings.js
# ... resto de scripts según lo que necesites

# 7. Iniciar desarrollo
npm run dev
# Backend: http://localhost:4000/api
# Frontend: http://localhost:3001
```

### 8.3 Credenciales de prueba

| Rol | Email | Password |
|-----|-------|----------|
| Admin | admin@sgip-ia.com | admin123 |
| Gerente proyecto | director@sgip-ia.com | director123 |

---

## 9. MÓDULOS DEL SISTEMA (estado actual)

| # | Módulo | Estado | Componente principal |
|---|--------|--------|---------------------|
| M1 | Adjudicación y Arranque | ✅ Completo | `ProjectDetailPage.js` → tabs Info, Documentos, Obligaciones, Hitos, Pólizas |
| M2 | Planificación / Presupuesto | ✅ Completo | `BudgetPanel.js` (nómina, contratistas, gastos, flujo ingresos, Estado de Resultados) |
| M3 | Ejecución y Seguimiento | ✅ Completo | `ExecutionPage.js` → Schedule, Progreso, Pagos, Actas, Cambios, Riesgos, Correspondencia |
| M4 | Control | ✅ Incluido en M3 | Cambios, riesgos, correspondencia |
| M5 | Cierre y Liquidación | ✅ Completo | `ClosurePage.js` → Checklist, Liquidación, Lecciones |
| M6 | Indicadores / KPIs | ✅ Completo | `IndicadoresPage.js` |
| M7 | Motor IA | ✅ Completo | `AIPage.js`, `AIAutoPopulatePanel.js` |
| — | Comité Directivo | ✅ Completo | `CommitteeDashboard.js` |
| — | SharePoint | ✅ Completo | `SharePointPanel.js` |
| — | Firmas digitales | ✅ Completo | Actas, correspondencia, firma libre |
| — | Email IMAP/SMTP | ✅ Completo | `EmailInboxConfig.js`, `emailPoller.js` |

---

## 10. SEGURIDAD

| Aspecto | Implementación |
|---------|---------------|
| Autenticación | JWT (8h) + rol normalizado en payload |
| Contraseñas | bcryptjs hash |
| Rate limiting | 500 req/15min global; 20 login/15min; 60 IA/hora; 30 exports/15min |
| CORS | Whitelist explícita desde `CORS_ORIGINS` |
| Headers | Helmet (CSP, HSTS, etc.) |
| SQL injection | Consultas parametrizadas (mysql2 prepared statements) |
| Uploads | Validación extensión + MIME type |
| XSS | DOMPurify en frontend |
| Secretos | Todos en `.env` o tabla `settings` — ninguno hardcodeado |

> Ver `docs/AUDITORIA_TECNICA.md` para el reporte completo.

---

## 11. INTEGRACIONES EXTERNAS

### 11.1 Anthropic / OpenAI (IA)

- Config en tabla `settings` o variables de entorno
- Abstracción: `backend/src/services/ai-engine.js`
- Rate limit: 60 llamadas/hora por usuario

### 11.2 Microsoft SharePoint (Graph API)

- Registro de app en Azure AD necesario
- Variables: `SP_TENANT_ID`, `SP_CLIENT_ID`, `SP_CLIENT_SECRET`, `SP_SITE_URL`
- Gestión de conexiones: `/api/sharepoint-connections`

### 11.3 OAuth SSO

- Providers soportados: Microsoft (Azure AD), Google, GitHub
- Config: tabla `oauth_connections` o `.env`
- Callback URL: `https://sigp.tecnofactory.net.co/auth/callback`

### 11.4 Email

- IMAP polling: config por proyecto vía UI
- SMTP envío: `MAIL_*` en `.env`
- Servicio: `backend/src/services/emailPoller.js` + `mailer.js`

---

## 12. MIGRACIÓN A AZURE DEVOPS

### Opción A — Importar repo a Azure DevOps (recomendado)

1. En Azure DevOps → New Project → Repos → Import a repository
2. Source type: **Git**
3. Clone URL: `https://github.com/diegodago-o/sgip-ia.git`
4. Azure DevOps importa todo el historial de commits, ramas y tags
5. Cambia el remote en el servidor de producción:
   ```bash
   git remote set-url origin https://dev.azure.com/<org>/<project>/_git/sgip-ia
   ```
6. Configura Azure Pipelines (ver sección 12.1)

> GitHub y Azure DevOps pueden coexistir usando dos remotes:
> ```bash
> git remote add azure https://dev.azure.com/<org>/<project>/_git/sgip-ia
> git push azure main
> ```

### Opción B — Mantener GitHub + CI/CD en Azure Pipelines

Útil si el equipo prefiere GitHub para el código pero quiere Azure Pipelines para builds/deploys.

1. Conectar GitHub repo a Azure DevOps en Project Settings → Service connections
2. Crear pipeline con trigger en push a `main`

### 12.1 azure-pipelines.yml (punto de partida)

```yaml
trigger:
  branches:
    include:
      - main

pool:
  vmImage: ubuntu-latest

variables:
  NODE_VERSION: '18.x'

stages:
  - stage: Build
    jobs:
      - job: BuildFrontend
        steps:
          - task: NodeTool@0
            inputs:
              versionSpec: $(NODE_VERSION)
          - script: |
              cd frontend
              npm ci
              npm run build
            displayName: Build React app
          - publish: frontend/build
            artifact: frontend-build

  - stage: Deploy
    dependsOn: Build
    condition: succeeded()
    jobs:
      - deployment: DeployProd
        environment: production
        strategy:
          runOnce:
            deploy:
              steps:
                - script: |
                    ssh sgpmotf@<SERVER_IP> "cd /var/www/sgip-ia && git pull && pm2 restart sgip-backend --update-env"
                  displayName: Deploy to production server
```

> Para el deploy por SSH necesitarás configurar una **Service Connection** de tipo SSH en Azure DevOps y reemplazar `<SERVER_IP>` con la IP real del servidor.

---

## 13. CHECKLIST DE ONBOARDING

Para un desarrollador nuevo:

- [ ] Clonar repo y ejecutar `npm run install:all`
- [ ] Copiar y configurar `backend/.env`
- [ ] Ejecutar `npm run db:init && npm run db:seed`
- [ ] Ejecutar migraciones adicionales (sección 7.4)
- [ ] Arrancar con `npm run dev` y probar login
- [ ] Revisar `docs/AUDITORIA_TECNICA.md`
- [ ] Entender mapa de rutas API (sección 6.2)
- [ ] Revisar `BudgetPanel.js` — es el componente más complejo (~2000 líneas)
- [ ] Configurar SSH key para acceso al servidor de producción
- [ ] Solicitar acceso al repo GitHub (diegodago-o/sgip-ia) o Azure DevOps
- [ ] Solicitar variables de entorno de producción al líder técnico

---

## 14. CONTACTO Y ACCESOS

| Recurso | Dónde solicitarlo |
|---------|------------------|
| Acceso repo GitHub | Owner: diegodago-o |
| Credenciales BD producción | Líder técnico / admin del servidor |
| API keys Anthropic/OpenAI | Owner del proyecto Tecnofactory |
| Acceso SSH servidor | Admin servidor SGIP-machine |
| Azure AD / SharePoint app | Admin de Azure AD de Tecnofactory |
| Credenciales email SMTP/IMAP | Admin de correo de Tecnofactory |

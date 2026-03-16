# SGIP-IA — Sistema de Gestión Integral de Proyectos con IA

## Requisitos previos

- **Node.js** 18+ → https://nodejs.org
- **MySQL** 8.0+ → https://dev.mysql.com/downloads/
- **npm** (viene con Node.js)

## Instalación rápida

```bash
# 1. Clonar o copiar el proyecto
cd sgip-ia

# 2. Instalar dependencias (backend + frontend)
npm run install:all

# 3. Configurar base de datos
#    Editar backend/.env con tus credenciales de MySQL:
#    DB_USER=root
#    DB_PASSWORD=tu_password

# 4. Crear base de datos y tablas
npm run db:init

# 5. Crear usuario de prueba
npm run db:seed

# 6. Iniciar todo (backend + frontend)
npm install          # instala concurrently
npm run dev
```

## URLs

| Servicio  | URL                       |
|-----------|---------------------------|
| Frontend  | http://localhost:3000      |
| API       | http://localhost:4000/api  |
| Health    | http://localhost:4000/api/health |

## Credenciales de desarrollo

| Rol       | Email                   | Contraseña   |
|-----------|-------------------------|--------------|
| Admin     | admin@sgip-ia.com       | admin123     |
| Director  | director@sgip-ia.com    | director123  |

## Estructura del proyecto

```
sgip-ia/
├── backend/
│   ├── src/
│   │   ├── config/         # Conexión a BD
│   │   ├── middleware/      # Auth JWT
│   │   ├── routes/          # Endpoints API
│   │   └── server.js        # Entry point
│   ├── scripts/
│   │   ├── init-db.js       # Crea BD y tablas
│   │   └── seed.js          # Datos de prueba
│   ├── .env                 # Variables de entorno
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── auth/        # Login, ProtectedRoute
│   │   │   ├── layout/      # Sidebar, TopBar, MainLayout
│   │   │   └── pages/       # Dashboard, Placeholder
│   │   ├── context/         # AuthContext
│   │   ├── services/        # API client (axios)
│   │   ├── App.js           # Router principal
│   │   └── index.js         # Entry point
│   ├── tailwind.config.js
│   └── package.json
└── package.json              # Scripts raíz
```

## Stack tecnológico

- **Backend:** Node.js + Express + MySQL 8 + JWT
- **Frontend:** React 18 + Tailwind CSS + Recharts + Lucide Icons
- **Auth:** JWT con refresh automático

## Módulos del sistema

| #  | Módulo                    | Estado          |
|----|---------------------------|-----------------|
| M1 | Adjudicación y Arranque   | Próximo a construir |
| M2 | Planificación             | Pendiente       |
| M3 | Ejecución y Seguimiento   | Pendiente       |
| M4 | Control y Cambios         | Pendiente       |
| M5 | Cierre y Liquidación      | Pendiente       |
| M6 | Indicadores y KPIs        | Pendiente       |
| M7 | Motor IA e Integraciones  | Pendiente       |

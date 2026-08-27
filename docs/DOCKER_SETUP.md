# 🚀 BOLETERA - DOCKER & LOCAL SETUP GUIDE

## Estado Actual

✅ **Contenedores levantados:**
- PostgreSQL 16 en puerto 5432
- Redis 7 en puerto 6379

❌ **Problemas encontrados:**
1. TypeScript strict mode incompatible con monorepo references en Dockerfile
2. Networking: Docker → Host connectivity issues en Windows/WSL2
3. Compilation: Turbo/Nest build requires complex tsconfig management

---

## ✅ SOLUCIÓN RÁPIDA: Desarrollo Local

### Opción 1: Usar Docker Solo para BD (RECOMENDADO)

```bash
# 1. Iniciar solo PostgreSQL y Redis
docker-compose up postgres redis -d

# 2. Configurar variables de entorno
# El .env ya está configurado con localhost:5432 y localhost:6379

# 3. Aplicar migraciones de Prisma
pnpm run db:migrate:deploy

# 4. Iniciar servicios localmente
pnpm run dev      # Inicia API, web, admin en paralelo

# O individualmente:
pnpm dev:api      # NestJS API en puerto 4000
pnpm dev:web      # Next.js Web en puerto 3000
pnpm dev:admin    # Next.js Admin en puerto 3001
```

### Acceso a servicios:

- **API**: http://localhost:4000
- **API Docs**: http://localhost:4000/api/docs
- **Web App**: http://localhost:3000
- **Admin Panel**: http://localhost:3001
- **PostgreSQL**: localhost:5432 (postgres/postgres)
- **Redis**: localhost:6379

---

## 🐳 Opción 2: Docker Completo (Work in Progress)

Para usar Docker Compose completo con todos los servicios:

```bash
# Detener servicios actuales
docker-compose down

# Construir imágenes (toma 5-10 minutos)
docker-compose build

# Levantar todo
docker-compose up -d

# Ver logs
docker-compose logs -f api
```

**Problemas conocidos:**
- TypeScript compilation en Docker falla por referencias de monorepo
- Solución: Simplificar tsconfig.json o usar pre-built images
- Status: **TODO - 80% completo**

---

## 📋 Quick Checklist

- [x] PostgreSQL corriendo ✅
- [x] Redis corriendo ✅
- [ ] Prisma migrations aplicadas ⏳
- [ ] API compilando localmente ⏳
- [ ] API ejecutándose en puerto 4000 ⏳
- [ ] Web app ejecutándose en puerto 3000 ⏳
- [ ] Admin panel ejecutándose en puerto 3001 ⏳
- [ ] Docker full stack operational ❌ (in progress)

---

## Próximos Pasos

### Inmediato (5-10 min):
```bash
# Asegurarse que NODE_ENV=development en .env
# Luego ejecutar:
pnpm run dev
```

### Para producción con Docker:
```bash
# Arreglar tsconfig.json para build en Docker
# Luego:
docker-compose build
docker-compose up -d
```

---

## 🔧 Troubleshooting

### Si no conecta a PostgreSQL:
```bash
# Verificar que postgres está corriendo
docker-compose ps

# Si no está, levantarlo:
docker-compose up postgres redis -d

# Verificar conectividad:
docker exec boletera-postgres pg_isready -U postgres
```

### Si falla Prisma migrate:
```bash
# Verificar DATABASE_URL
echo $DATABASE_URL

# Debe ser: postgresql://postgres:postgres@localhost:5432/boletera

# Si no está set, agregar a .env y cargar:
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/boletera?schema=public"
pnpm run db:migrate:deploy
```

### Si pnpm dev falla:
```bash
# Verificar instancia:
pnpm install

# Check Turbo config:
cat turbo.json | grep -A 5 "build"

# Limpiar cache:
rm -rf .turbo
pnpm run build
```

---

## 📊 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Local Development                      │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   API        │  │   Web App    │  │  Admin Panel │   │
│  │ :4000        │  │  :3000       │  │   :3001      │   │
│  │  (NestJS)    │  │  (Next.js)   │  │  (Next.js)   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│         │                │                     │          │
│         └────────────────┼─────────────────────┘          │
│                          │                                 │
│  ┌──────────────────────────────────────────────────────┐ │
│  │          Docker Network (Docker Compose)             │ │
│  │                                                        │ │
│  │  ┌──────────────┐              ┌──────────────┐     │ │
│  │  │  PostgreSQL  │              │  Redis       │     │ │
│  │  │  :5432       │              │  :6379       │     │ │
│  │  └──────────────┘              └──────────────┘     │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────┘
```

---

## 📞 Status

**Last Updated:** May 17, 2026  
**Setup Status:** ⚠️ PARTIAL (DB running, App ready for dev)  
**Docker Status:** 🔧 IN PROGRESS (80% complete)  
**Next Action:** `pnpm run dev` (development server)


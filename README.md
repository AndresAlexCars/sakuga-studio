# Sakuga Studio

Aplicación web (y PWA para Android) que genera ilustraciones de anime con **FLUX** a través de la API de **fal.ai**.
Frontend sin frameworks, backend en Node.js + Express. La clave del proveedor vive solo en el servidor.

## Estructura

```
sakuga-studio/
├── package.json
├── .env.example          ← copia a .env y rellena
├── server/
│   ├── index.js          ← Express, cabeceras de seguridad, archivos estáticos
│   ├── config.js         ← lee variables de entorno
│   ├── catalog.js        ← estilos, proporciones, resoluciones, modelos
│   ├── middleware/auth.js
│   ├── routes/api.js     ← /api/config, /generate, /history
│   └── services/
│       ├── fal.js        ← cliente de fal.ai (la clave se usa solo aquí)
│       ├── generator.js  ← flujo: validar → generar → descargar → guardar
│       ├── moderation.js ← filtro de prompts
│       └── store.js      ← imágenes en disco + historial JSON
└── public/
    ├── index.html
    ├── css/styles.css
    ├── js/app.js, api.js
    ├── manifest.webmanifest
    └── icon.svg
```

## Puesta en marcha

1. Crea una cuenta en https://fal.ai, añade saldo y genera una clave en https://fal.ai/dashboard/keys
2. En la carpeta del proyecto:
   ```
   npm install
   cp .env.example .env     # edita .env: FAL_KEY y ACCESS_CODE
   npm start
   ```
3. Abre http://localhost:3000
4. Para probar desde tu teléfono en la misma wifi, abre `http://IP-DE-TU-PC:3000`.

## Costos aproximados (por imagen de 1024×1024, ~1 megapíxel)

| Modo en la app | Modelo | Costo aprox. |
|---|---|---|
| Rápido | FLUX.1 [schnell] | US$0.003 (≈ US$3 por 1000) |
| Calidad | FLUX1.1 [pro] | US$0.04 (≈ US$40 por 1000) |

Se cobra por megapíxel: 768×768 cuesta ~56 % de 1024×1024 y 1344×1344 cuesta ~1.8 veces más.
La app muestra una estimación antes de generar. Verifica precios vigentes en https://fal.ai/pricing.
FLUX.1 [dev] no se incluye porque su licencia es no comercial.

## Seguridad incluida

- `FAL_KEY` solo en variables de entorno del servidor; nunca viaja al navegador.
- `ACCESS_CODE` opcional pero muy recomendado: sin él, cualquiera con tu URL gasta tu saldo.
- Límite por IP (`RATE_LIMIT_PER_10_MIN`) y tope global diario (`DAILY_LIMIT`).
- Validación estricta de entradas, cabeceras con Helmet y CSP.
- Filtro de prompts en el servidor + filtro de seguridad del proveedor activado.
- El historial se separa por dispositivo. Las imágenes tienen nombre UUID aleatorio.

## Despliegue

Necesita un servidor Node (no sirve un hosting estático). Opciones: Render, Railway, Fly.io o un VPS.
- Define `FAL_KEY`, `ACCESS_CODE` y `TRUST_PROXY=1` en el panel del proveedor.
- Monta un **disco persistente** y apunta `DATA_DIR` a él; si no, las imágenes se pierden en cada reinicio.
- Comando de inicio: `npm start`.

## Instalar en Android

En Chrome: menú ⋮ → "Añadir a pantalla de inicio". Para que Chrome lo ofrezca como app instalable completa,
añade iconos PNG de 192×192 y 512×512 en `public/` y decláralos en `manifest.webmanifest`.

## Mejoras futuras

- Más fidelidad al anime: usar `fal-ai/flux-lora` con un LoRA de anime.
- Cuentas de usuario reales + base de datos (SQLite/Postgres) y almacenamiento S3.
- Seed fijo para variaciones controladas de una misma imagen.

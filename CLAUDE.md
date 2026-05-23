# Bot WhatsApp E-commerce RD
## Especificaciones completas

> **Version:** 2.0 | **Stack:** Node.js · Express · Meta Cloud API · OpenAI (GPT-4o Mini) · Google Sheets API
> **Fase actual:** MVP → Fase 1 (Google Sheets). Fase 2 migrará a Supabase.

---

## 1. CONTEXTO DEL NEGOCIO

E-commerce en República Dominicana que vende accesorios para automóviles. Clientes llegan por **Meta Ads**, completan formulario en landing page. Modelo: **Cash on Delivery (COD)**. Shopify envía mensaje de WhatsApp al número del negocio con datos del pedido. El bot gestiona la conversación con el cliente de forma autónoma usando **GPT-4o Mini**.

---

## 2. MENSAJE DE ENTRADA (formato fijo de Shopify)

```
¡Hola!
Mi nombre es {NOMBRE_CLIENTE}
He realizado un pedido de {NOMBRE_PRODUCTO}, en su tienda por un total de RD$ {MONTO}.
Mis datos de entrega son:
{DIRECCION_LINEA_1}
{SECTOR}, {CIUDAD_MUNICIPIO}
{PROVINCIA}
{MUNICIPIO}
Quiero CONFIRMAR mi pedido GRACIAS.
```

### Regla de clasificación de zona:
- **SDQ** — Santo Domingo, Santo Domingo Este/Norte/Oeste, Distrito Nacional, DN, Los Alcarrizos, Pedro Brand, San Antonio de Guerra
- **STI** — Santiago, Santiago de los Caballeros
- **interior** — cualquier otra ciudad o provincia

---

## 3. FLUJO CONVERSACIONAL

### 3.1 Mensaje nuevo de pedido
TRIGGER: Mensaje contiene "He realizado un pedido" y "Quiero CONFIRMAR"
1. Parsear campos → registrar en Sheets (estado=Pendiente) → registrar log → programar seguimiento #1 en 3h
2. **SDQ/STI:** Preguntar hora disponible para entrega
3. **interior:** Solicitar ubicación GPS por WhatsApp

### 3.2 Cliente responde hora (SDQ/STI)
→ Confirmar pedido con resumen → estado=Confirmado → cancelar seguimientos

### 3.3 Cliente envía ubicación GPS (interior)
→ Confirmar recepción → estado=Confirmado → cancelar seguimientos

### 3.4 Sistema de seguimientos (sin respuesta)
- **Intento #1** a las 3h: recordatorio amigable → programar intento #2 en 3h más
- **Intento #2** a las 6h: último aviso → esperar 1h → escalar al dueño → estado=Problema → pausar bot

### 3.5 Escalamiento al dueño
TRIGGER: 2 intentos fallidos O cliente pide hablar con persona
→ Mensaje al número personal del dueño con resumen → bot pausado para ese número

### 3.6 Mensajes fuera del flujo
Claude razona con contexto. Si no puede responder con certeza → escalar al dueño.

---

## 4. FUNCIONES OPENAI (Function Calling)

| Función | Descripción |
|---|---|
| `parsear_pedido` | Extrae datos estructurados del mensaje de Shopify |
| `actualizar_estado_pedido` | Actualiza estado en Sheets (pendiente/confirmado/en_preparacion/empacado/en_camino/entregado/problema) |
| `registrar_log` | Registra acción en Log Diario |
| `programar_seguimiento` | Crea entrada en hoja Seguimientos |
| `cancelar_seguimientos` | Cancela seguimientos pendientes de un número |
| `escalar_a_dueno` | Notifica al dueño y pausa el bot |
| `pausar_bot` | Pausa el bot para un número específico |
| `generar_resumen_diario` | Genera resumen del día (solo cron 9pm) |

---

## 5. ESTRUCTURA DE GOOGLE SHEETS

- **Hoja 1: Pedidos** — #Pedido, Nombre, Teléfono/WA, Producto, Monto, Ciudad, Dirección, Estado, Intentos Bot, Último Contacto, Notas
- **Hoja 2: Conversaciones** — Teléfono/WA, Nombre, #Pedido Ref., Estado Bot (activo/pausado/escalado), Intentos, Último Msg Enviado, Último Msg Recibido, Fecha Inicio
- **Hoja 3: Log Diario** — Fecha y Hora, Nombre, Teléfono/WA, Acción, Detalle, Estado Resultante
- **Hoja 4: Dashboard** — Vista automática con fórmulas (NO editar manualmente)
- **Hoja 5: Seguimientos** — Teléfono/WA, Nombre, #Pedido, Intento #, Enviar A Las, ¿Enviado?, Resultado

---

## 6. ARQUITECTURA

```
/tropicland-bot
├── index.js          → servidor Express + webhook Meta
├── .env              → variables de entorno (NO subir a git)
├── .env.example      → plantilla
├── package.json
├── src/
│   ├── bot.js        → orquestador principal
│   ├── openai.js     → config OpenAI + tool definitions
│   ├── tools.js      → implementación de cada tool
│   ├── sheets.js     → operaciones Google Sheets
│   ├── meta.js       → envío de mensajes Meta Cloud API
│   └── cron.js       → jobs de seguimiento y resumen
└── config/
    └── sheets-credentials.json  → Google Service Account
```

---

## 7. CHECKLIST DE IMPLEMENTACIÓN

### Fase 1 — MVP con Google Sheets y Meta Cloud API

#### Lo que debes hacer tú (credenciales y configuración externa):
- [ ] Crear app en Meta for Developers y solicitar acceso a WhatsApp Cloud API
- [ ] Obtener número de teléfono Business de Meta
- [ ] Generar token de acceso de larga duración (Meta)
- [ ] Crear cuenta OpenAI y obtener API Key
- [ ] Crear Google Sheet con las 5 hojas especificadas
- [ ] Configurar Google Service Account y descargar credentials JSON
- [ ] Copiar `.env.example` a `.env` y llenar todos los valores
- [ ] Pegar el JSON de Service Account en `config/sheets-credentials.json`
- [ ] Deploy en Railway o Render (exponer URL pública para webhook)
- [ ] Configurar webhook URL en Meta for Developers
- [ ] Prueba completa con número personal antes de activar producción

#### Lo que está construido (código):
- [x] Servidor Express con webhook `/webhook` para Meta
- [x] Validación de webhook (GET para verificación + POST para mensajes)
- [x] Parseo de mensajes con OpenAI Function Calling
- [x] Escritura en Google Sheets (todas las hojas)
- [x] Flujo SDQ/STI (pregunta de hora)
- [x] Flujo interior (solicitar ubicación GPS)
- [x] Detección de confirmación y actualización de estado
- [x] Sistema de seguimientos con programar/cancelar
- [x] Cron job de seguimientos (cada 30 min)
- [x] Escalamiento al dueño via Meta
- [x] Cron job de resumen diario (9pm hora RD)
- [x] Rate limiting (10 mensajes/número/hora)
- [x] Manejo de errores con reintentos en Sheets API
- [x] Casos edge (voz/imagen, bot pausado, mensajes fuera de flujo)

### Fase 2 — Migración a Supabase (post-validación)
- [ ] Crear tablas en Supabase (ver spec original para SQL)
- [ ] Reemplazar `sheets.js` con `supabase.js`
- [ ] Integrar con Kanban del software existente

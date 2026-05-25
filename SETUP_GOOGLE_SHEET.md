# Tarea: Crear Google Sheet para Tropicland Bot

## Objetivo
Crear el Google Sheet que usa el bot de WhatsApp de Tropicland para registrar pedidos, conversaciones y logs. El Sheet debe tener 5 hojas con sus headers exactos.

## Contexto del proyecto
- El bot ya está construido en `c:\Users\nuevoadmin\Desktop\tropicland-bot`
- Usa la Google Sheets API con una Service Account
- El archivo `src/sheets.js` ya tiene toda la lógica de lectura/escritura
- El endpoint `POST /setup` del servidor crea los headers automáticamente si las hojas existen

## Lo que necesitas hacer

### 1. Crear el Google Sheet
Crear un Google Sheet llamado **"Tropicland Bot"** con estas 5 hojas (pestañas):

| Nombre de pestaña | Headers (fila 1) |
|---|---|
| `Pedidos` | #Pedido, Nombre, Teléfono/WA, Producto, Monto, Ciudad, Dirección, Estado, Intentos Bot, Último Contacto, Notas |
| `Conversaciones` | Teléfono/WA, Nombre, #Pedido Ref., Estado Bot, Intentos, Último Msg Enviado, Último Msg Recibido, Fecha Inicio |
| `Log Diario` | Fecha y Hora, Nombre, Teléfono/WA, Acción, Detalle, Estado Resultante |
| `Dashboard` | (dejar vacía, tiene fórmulas automáticas) |
| `Seguimientos` | Teléfono/WA, Nombre, #Pedido, Intento #, Enviar A Las, ¿Enviado?, Resultado |

### 2. Compartir el Sheet con la Service Account
Una vez creado, compartir el Sheet con permisos de **Editor** con el email de la Service Account que el usuario tiene en `config/sheets-credentials.json`.

### 3. Entregar al usuario
- El **ID del Sheet** (extraído de la URL: `docs.google.com/spreadsheets/d/ESTE_ID/edit`)
- Confirmación de que las 5 hojas están creadas con sus headers

## Lo que el usuario hace después
Con el ID en mano, el usuario lo pone en su `.env`:
```
GOOGLE_SHEET_ID=el_id_que_obtuviste
```

## Autenticación Google Drive
Usar el MCP de Google Drive disponible en Claude:
1. Llamar `mcp__claude_ai_Google_Drive__authenticate`
2. El usuario completa el flujo OAuth en el navegador
3. Llamar `mcp__claude_ai_Google_Drive__complete_authentication` con el código
4. Crear el Sheet usando las herramientas disponibles

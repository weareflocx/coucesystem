# Sincronización de biblioteca

## Modelo

Cauce conserva primero todos los proyectos y paletas en `localStorage`. La sincronización remota es opcional y no interviene en el render ni en la edición.

```text
localStorage
    │
    ├── respuesta inmediata y modo offline
    │
    ▼
/api/library · Netlify Function
    │
    ▼
Netlify Blobs · cauce-system/workspace/library.v1.json
```

En desarrollo con `npm run dev`, el mismo contrato usa `.cauce/library.json` mediante el endpoint local `/__cauce/library`. En un build de producción sin clave activa, Cauce se mantiene únicamente en el navegador.

## Seguridad

La Function exige `Authorization: Bearer <clave>` y compara su hash en tiempo constante con `CAUCE_LIBRARY_KEY`. Si la variable no existe, responde `503`; si la clave no coincide, responde `401`.

`CAUCE_LIBRARY_KEY` debe configurarse como secreto de Netlify con alcance de Functions. No debe tener prefijo `VITE_`, incluirse en `.env` versionados ni escribirse en código cliente.

Studio guarda la clave introducida en `sessionStorage`: sobrevive a una recarga dentro de la misma pestaña, pero desaparece al cerrar la pestaña. Esta autenticación compartida es adecuada para un workspace privado. No sustituye un sistema de usuarios, permisos o auditoría.

## Consistencia

La Function usa `getStore("cauce-system", { consistency: "strong" })`. Las escrituras son condicionales mediante ETag y se reintentan si otra sesión modifica la biblioteca durante la operación.

Proyectos y paletas se combinan por `id` y `updatedAt`. Las eliminaciones se conservan como tombstones con `deletedAt`; así, un dispositivo que estuvo offline no puede recuperar accidentalmente un elemento eliminado desde otro dispositivo.

El formato remoto mantiene `schemaVersion: 1` y acepta backups anteriores que no incluyan `colors` o `tombstones`.

## Endpoints

- `GET /api/library`: obtiene la biblioteca remota.
- `PUT /api/library`: combina un backup local con la biblioteca remota.
- `DELETE /api/library?id=<uuid>`: elimina un proyecto y registra el tombstone.
- `DELETE /api/library?colorId=<uuid>`: elimina una paleta y registra el tombstone.

Todas las respuestas usan `Cache-Control: no-store`. El cuerpo máximo aceptado por Cauce es 5 MB.

## Evolución

Si Cauce necesita varios usuarios o equipos, se sustituirá la clave compartida por identidad real. El `userId` o `workspaceId` pasará a formar parte de la clave del Blob, manteniendo el mismo contrato del cliente. Para búsquedas, permisos por registro, auditoría o colaboración simultánea intensiva, conviene migrar la persistencia a una base de datos transaccional.

## Referencia

- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Variables de entorno en Functions](https://docs.netlify.com/build/functions/environment-variables/)

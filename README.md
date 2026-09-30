# Gestión de clientes

Panel para gestionar a los clientes de la app de finanzas ([Finanzas-app](https://github.com/PaulaRamis04/Finanzas-app)). Usa el mismo Supabase, así que los cambios se ven al momento en la app.

- **Resumen**: clientes, premium, asesorías sin leer y mensajes del buzón por resolver.
- **Clientes**: buscar, dar o quitar Premium o Premium + asesoría (con fecha de fin, aportación y nota) e historial de cambios.
- **Mini asesoría**: chat con cada cliente que tiene el plan de asesoría.
- **Buzón**: ideas, fallos y supporters de la pestaña Comunidad; se responden desde aquí y a un supporter se le activa el plan con un botón.

## Puesta en marcha

1. En Supabase, abre el SQL Editor y ejecuta `schema_gestion.sql` (después de `schema_premium.sql` y `schema_comunidad.sql`). Se puede ejecutar más de una vez.
2. Date de alta como administradora con tu email (la línea está al principio de `schema_gestion.sql`):
   ```sql
   insert into public.admins (user_id, email) select id, email from auth.users where email = 'TU_EMAIL' on conflict do nothing;
   ```
3. Abre `index.html` (o publícalo, por ejemplo con GitHub Pages) y entra con tu cuenta de la app de finanzas. Una cuenta que no esté en `admins` no ve ningún dato: lo impide Supabase, no solo la pantalla.

No hace falta instalar nada: es HTML y JavaScript, como la app de finanzas.

## Lo que ve el cliente

Para que tus clientes vean tus respuestas del buzón y el chat de la mini asesoría en su pestaña Comunidad, la app de finanzas necesita un cambio pequeño (lee las tablas `comunidad`, `suscripciones` y `asesoria_mensajes`). Sin él, el panel funciona igual, pero las respuestas solo llegan si escribes por email.

El premium que ya diste a mano en la tabla `perfiles` se sigue respetando; si le cambias el plan desde aquí, pasa a gestionarse desde este panel.

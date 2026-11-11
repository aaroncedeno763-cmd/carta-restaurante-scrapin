# Cartas de restaurantes de Mallorca

Proyecto en JavaScript con Node.js y Playwright, usando Chrome y sin Serper. Busca restaurantes en Google Maps, compara las fichas con la fuente y recopila fotos desde Carta/Menú, por lotes con progreso persistente.

## Entorno y datos

Requiere Node.js 22 o superior y Chrome instalado.

```powershell
npm ci
npm run importar
```

La fuente local `establecimientos.geojson` contiene 10.612 establecimientos. La importación conserva el original y selecciona `Grup=Restaurant` y `Estat=Alta`: 4.266 restaurantes. Genera `data/restaurantes-con-ids.geojson`.

`data/ids.json` se copió del proyecto anterior y mantiene la relación entre `Signatura` e `_id`. Si falta, la importación se detiene. No lo borres ni reasignes los IDs. Conserva una copia de seguridad: los datos locales no se recuperan clonando Git. El proyecto anterior no se modifica.

## Cuenta de Maps

```powershell
npm run iniciar:maps
```

Abre Chrome visible con un perfil exclusivo en `browser-profile/chrome/`. Inicia sesión manualmente con la cuenta del proyecto y completa las verificaciones de Google. No necesitas activar la sincronización de Chrome. Cierra esa ventana antes de ejecutar el recorrido para liberar el perfil y guardar la sesión.

El recorrido utiliza Chrome visible: en las pruebas, el modo sin ventana seguía mostrando la vista limitada. No utiliza tu perfil habitual. No compartas contraseñas, códigos ni perfiles del navegador.

## Recorrido completo

Simula los siguientes cinco pendientes, sin abrir Chrome ni escribir archivos:

```powershell
npm run recorrer
```

Procesa esos cinco:

```powershell
npm run recorrer -- --execute
```

Repite el comando para continuar con los siguientes pendientes. Cada ejecución procesa cinco por defecto y admite hasta 25. Hay una pausa de tres segundos entre restaurantes.

Para continuar automáticamente con **todos los pendientes**, utiliza `--all`:

```powershell
npm run recorrer -- --all --max-fotos 4 --execute
```

No combina `--all` con `--limit` o `--ids`. Mantiene la pausa entre restaurantes, los criterios de coincidencia y la parada ante interrupciones de Maps. Para reanudar después de cerrar el programa, ejecuta el mismo comando; los IDs ya procesados con esa configuración se omiten. Los pendientes de revisión se consideran revisados por el programa y requieren intervención o repetición explícita, no una descarga automática.

Para seleccionar una muestra o ajustar los límites:

```powershell
npm run recorrer -- --ids 14,23 --execute
npm run recorrer -- --limit 10 --max-fotos 4 --execute
```

`--ids` admite IDs activos distintos y no puede superar `--limit`. `--max-fotos` admite de 1 a 10 fotos por restaurante, con valor inicial 2. No garantiza que la carta esté completa. Aumentar el límite de fotos permite ampliar lo recogido en ejecuciones posteriores.

### Qué comprueba

1. Busca por nombre, dirección y municipio, sin enlaces de fichas precargados ni datos del explotador.
2. Revisa hasta tres candidatos visibles. Usa las coordenadas de la ficha, nunca el centro de la cámara del mapa.
3. Solo propone una coincidencia si concuerdan nombre, calle, número, municipio o localidad, categoría compatible y ausencia de cierre permanente observado. Si la fuente tiene coordenadas, exige una distancia máxima de 100 m. Si no las tiene, exige una dirección completa con número fiable. Si varios cumplen o se supera el límite de candidatos, queda pendiente.
4. Vuelve a comprobar la ficha antes de recopilar. Abre Carta/Menú y pulsa sus botones numerados de fotos. No recorre los platos destacados ni las fotos generales del negocio.
5. Guarda las imágenes y su procedencia con identidad probable y revisión visual pendiente.

Una coincidencia probable sigue siendo una propuesta automática. Los datos incompletos, cambios de nombre, abreviaturas y categorías desconocidas pueden dejar coincidencias reales pendientes. Las imágenes de Menú requieren revisar contenido, legibilidad y fecha; no se dan por vigentes sus precios. Los casos dudosos no reciben fotos.

Si no se observa sección o fotos de menú, el estado describe esa vista; no concluye que el restaurante carezca de carta. No se descargan webs o PDF externos.

### Progreso y reanudación

`data/recorrido-maps/progreso.json` conserva únicamente el estado por ID y una huella de configuración para reanudar. No se guardan consultas, candidatos, capturas, textos de páginas ni informes de búsqueda. Los resultados se muestran en la consola.

Los casos terminados, sin coincidencia o pendientes de revisión se omiten al repetir el comando. Un trabajo que quedó `en_proceso` se recupera en la siguiente ejecución. Si un estado indica fotos recopiladas pero sus archivos ya no están en disco, vuelve a ser elegible para descargarlas. Las fotos guardadas se conservan. Un cambio en los criterios de coincidencia hace que los registros anteriores se vuelvan a evaluar.

Para volver a intentar errores o interrupciones registradas:

```powershell
npm run recorrer -- --retry-errors --execute
```

Para repetir expresamente unos IDs, incluidos los ya terminados:

```powershell
npm run recorrer -- --ids 14,23 --repeat --execute
```

Los cambios en los datos del restaurante o en el límite de fotos lo hacen elegible de nuevo. Un bloqueo impide dos recorridos simultáneos. No abras otra ventana con el mismo perfil mientras se ejecuta el recorrido.

Ctrl+C solicita detenerse al terminar la operación en curso y guardar el progreso. Los avisos detectados de CAPTCHA, tráfico inusual o denegación de descargas detienen el lote; no se resuelven automáticamente. Los errores ordinarios quedan registrados y el lote continúa. Hay hasta tres intentos de recuperación de un recurso de imagen observado si falla la lectura de su respuesta; las búsquedas no se repiten automáticamente.

### Archivos de fotos

Al procesar un restaurante se crea `cartas/<_id>/restaurante.json` con sus datos originales y su ID, aunque todavía no se haya encontrado una carta. Las imágenes se guardan en `cartas/<_id>/carta-<sha256>.jpg` y su procedencia en `cartas/<_id>/procedencia.json`.

Cuando se encuentra una ficha que supera la comprobación, se guarda también su número en el campo `telefono` de `restaurante.json`, tal como lo muestra Maps. Si no se observa un teléfono, queda `null`; si ya había uno guardado, se conserva. Se recoge aunque la ficha no exponga fotos de carta. Para añadirlo a restaurantes procesados anteriormente, selecciónalos con `--ids` y `--repeat`; las fotos existentes no se duplican.

`photos: 0` junto con `pendiente_revision` significa que no se ha aceptado una ficha para ese ID; la consola muestra el motivo. No significa que la descarga haya terminado correctamente. Para comprobar la descarga con los dos casos conocidos, ejecuta `npm run recorrer -- --ids 14,23 --max-fotos 1 --repeat --execute`.

Se admiten JPEG/PNG, con dimensiones mínimas de 500 × 300 y máximo de 20 MB. Se elige la mayor resolución que haya cargado realmente el visor, sin inventar URL. Se registra ficha, foto, ID de foto si está disponible, fecha mostrada, fecha de descarga, dimensiones, tamaño y SHA-256.

La huella evita duplicados idénticos y el ID de foto evita guardar de nuevo una versión igual o inferior. Si se obtiene una resolución mejor, se conserva la anterior y la nueva queda vinculada con `version_de`. Los archivos con una huella incorrecta o procedencia incompatible se conservan para revisión y no se sobrescriben.

## Datos locales

Git excluye la fuente, `data/`, `cartas/`, `.env`, perfiles del navegador y dependencias. Se versionan código, configuración y documentación. La extracción del texto de las cartas a JSON corresponde a una fase posterior.

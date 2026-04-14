# Calidad De Información De Proveedores

## Resumen Ejecutivo

- Hoy sí tenemos información suficiente para que el agente diferencie proveedores en la mayoría de los casos.
- Pero esa diferenciación todavía depende demasiado de texto descriptivo y no de campos estructurados confiables.
- En otras palabras: el agente puede recomendar, pero todavía no tiene una base sólida para comparar, rankear o filtrar con precisión.

## Qué Se Analizó

- Se hizo un censo completo del marketplace expuesto por el endpoint actual.
- Universo analizado:
  - 180 proveedores
  - 16 categorías
  - 15 páginas de listado
  - 180 fichas de detalle consultadas

## Hallazgo Principal

La foto general es bastante clara:

- Para explicar diferencias entre opciones, el detalle del proveedor suele alcanzar.
- Para tomar decisiones más finas, todavía falta estructura.

Esto es importante porque hoy el agente puede sonar útil en una shortlist, pero todavía corre el riesgo de apoyarse en señales débiles cuando queremos más precisión.

## Qué Sí Está Funcionando

- Después del enriquecimiento con detalle, 15 de 16 categorías quedan con proveedores distinguibles entre sí.
- El campo de descripción corta aparece en el 100% de los proveedores.
- En la mayoría de categorías el agente ya tiene suficiente material para decirle al usuario por qué una opción parece distinta de otra.

Lectura práctica:

- Para recomendaciones conversacionales, vamos razonablemente bien.
- Para una experiencia más “inteligente” y consistente, todavía no alcanza.

## Dónde Está El Problema

Los vacíos más fuertes están en la data estructurada:

- 176 de 180 proveedores tienen rating `0.0`.
- 146 de 180 no tienen una señal de precio usable.
- 121 de 180 no tienen ubicación.
- 180 de 180 no tienen `eventTypes`.

Eso significa que varios de los campos que uno esperaría usar para comparar opciones, en la práctica hoy no ayudan.

## Qué Pasa Con Promos Y Beneficios

Acá hay una oportunidad clara.

- 97 proveedores comunican descuentos, regalos o beneficios en el título.
- Pero esos beneficios no aparecen estructurados en `promoBadge` o `promoSummary`.

En la práctica, el beneficio existe, pero el sistema no lo puede leer bien como dato.

Resultado:

- el agente muchas veces sí “entiende” que hay una promo;
- pero lo hace leyendo texto libre, no apoyándose en una señal limpia y confiable.

## Qué Pasa Con Servicios Y Condiciones

- `serviceHighlights` y `termsHighlights` aparecen solo en 44.4% de los proveedores.
- Cuando existen, ayudan bastante.
- Cuando no existen, el agente termina apoyándose en descripciones largas.
- Además, algunos casos tienen ruido de parsing, por ejemplo frases genéricas como “Preguntar por paquetes” o “Consultar términos y condiciones”.

Conclusión:

- hay señal útil;
- pero todavía no es pareja ni suficientemente limpia.

## Riesgo Para El Producto

Si dejamos la data como está, el riesgo no es que el agente “no diga nada”.

El riesgo real es otro:

- puede diferenciar opciones con argumentos desparejos;
- puede sonar convincente usando texto semiestructurado;
- y puede no sostener comparaciones más exigentes cuando el usuario pide filtrar mejor, ordenar mejor o justificar por qué una opción es superior.

Eso limita especialmente:

- ranking de proveedores;
- filtros confiables;
- recomendaciones repetibles;
- y futuras automatizaciones más estrictas.

## Qué Significa Para El Agente Hoy

Con el estado actual de la data, el agente debería:

- priorizar promos, servicios, condiciones y descripción;
- usar precio y ubicación solo cuando realmente existan;
- evitar apoyarse en rating salvo que sea distinto de `0.0`;
- no usar `eventTypes` como señal de decisión por ahora.

## Qué Conviene Corregir Primero

Si queremos mejorar la calidad de recomendación sin rehacer todo, el orden sugerido es:

1. Estructurar bien promos y beneficios.
2. Completar ubicación de servicio.
3. Agregar una señal de precio utilizable.
4. Completar `eventTypes`.
5. Normalizar mejor servicios o paquetes.

## Por Qué Ese Orden

Porque ese orden nos da impacto rápido:

- Promo estructurada mejora diferenciación inmediata.
- Ubicación y precio mejoran filtro y relevancia.
- `eventTypes` evita recomendaciones incorrectas por contexto.
- Servicios normalizados mejoran comparación entre opciones parecidas.

## Recomendación Ejecutiva

La recomendación no es frenar el agente.

La recomendación es avanzar en dos frentes al mismo tiempo:

- seguir guiando el prompt para que use bien el detalle disponible;
- y abrir un trabajo upstream de calidad de datos sobre promos, ubicación, precio y tipología de servicio.

## Mensaje Final

Hoy el agente ya puede ayudar a elegir.

Lo que todavía no tiene es una base de datos lo suficientemente limpia como para comparar proveedores con la consistencia que vamos a necesitar a medida que el producto suba de nivel.

Si mejoramos esos pocos campos estructurales, la calidad de recomendación debería dar un salto visible sin cambiar la lógica central del agente.

## Anexo: Números Clave

- Marketplace analizado: 180 proveedores
- Categorías analizadas: 16
- Categorías con diferenciación suficiente tras detalle: 15 de 16
- Proveedores con rating `0.0`: 176
- Proveedores sin ubicación: 121
- Proveedores sin señal estructurada de precio: 146
- Proveedores sin `eventTypes`: 180
- Proveedores con promo implícita en texto pero no estructurada: 97

## Anexo: Fuente

- Artefacto base del análisis:
  - `analysis/provider-information-completeness/artifacts/provider-completeness-census.json`
- Hallazgos durables:
  - `analysis/provider-information-completeness/findings.md`

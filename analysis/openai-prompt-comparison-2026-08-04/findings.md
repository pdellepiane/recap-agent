# Static prompt comparison

Generated: 2026-08-04T16:41:35.856Z

Historical source: `dd0b6b6^`

Both sides were serialized with `gpt-5.6-luna` so the comparison isolates prompt shape rather than tokenizer/model changes.

Aggregate serialized request bytes fell from 635,882 to 319,703 (49.72% reduction).

Aggregate non-generative input tokens fell from 135,347 to 66,651 (50.76% reduction).

| Component | Route | Files before | Files now | Bytes before | Bytes now | Byte reduction | Tokens before | Tokens now |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| classifier | classifier | 1 | 1 | 9181 | 9181 | 0.00% | 1847 | 1847 |
| extractor | extractor:conversation_only | 6 | 1 | 47609 | 2269 | 95.23% | 10299 | 453 |
| extractor | extractor:initial_planning_information | 6 | 4 | 47620 | 8748 | 81.63% | 10301 | 1856 |
| extractor | extractor:active_plan | 6 | 6 | 47603 | 11595 | 75.64% | 10299 | 2441 |
| extractor | extractor:shortlist | 6 | 6 | 47601 | 11593 | 75.65% | 10299 | 2441 |
| reply | contacto_inicial | 11 | 7 | 16063 | 7304 | 54.53% | 3412 | 1556 |
| reply | deteccion_intencion | 11 | 7 | 15370 | 6611 | 56.99% | 3254 | 1398 |
| reply | existe_plan_guardado | 11 | 10 | 15351 | 9886 | 35.60% | 3254 | 2061 |
| reply | entrevista | 11 | 11 | 18030 | 13793 | 23.50% | 3813 | 2870 |
| reply | elicitacion_necesidades | 11 | 11 | 19254 | 15017 | 22.01% | 4023 | 3080 |
| reply | minimos_para_buscar | 11 | 11 | 15082 | 10845 | 28.09% | 3202 | 2259 |
| reply | aclarar_pedir_faltante | 11 | 11 | 15799 | 11562 | 26.82% | 3355 | 2412 |
| reply | usuario_responde | 11 | 11 | 15198 | 10961 | 27.88% | 3215 | 2272 |
| reply | buscar_proveedores | 11 | 10 | 15578 | 10113 | 35.08% | 3293 | 2100 |
| reply | busqueda_exitosa | 11 | 10 | 15025 | 9560 | 36.37% | 3188 | 1995 |
| reply | hay_resultados | 11 | 10 | 15138 | 9673 | 36.10% | 3209 | 2016 |
| reply | recomendar | 11 | 10 | 16699 | 11234 | 32.73% | 3528 | 2335 |
| reply | refinar_criterios | 11 | 11 | 16658 | 12421 | 25.44% | 3515 | 2572 |
| reply | usuario_elige_proveedor | 11 | 10 | 15621 | 10156 | 34.98% | 3303 | 2110 |
| reply | anadir_a_proveedores_recomendados | 11 | 10 | 15308 | 9843 | 35.70% | 3251 | 2058 |
| reply | seguir_refinando_guardar_plan | 11 | 10 | 17034 | 11569 | 32.08% | 3573 | 2380 |
| reply | continua | 11 | 10 | 15005 | 9540 | 36.42% | 3184 | 1991 |
| reply | accion_final_exitosa | 11 | 10 | 15142 | 9677 | 36.09% | 3205 | 2012 |
| reply | necesidad_cubierta | 11 | 10 | 15325 | 9860 | 35.66% | 3245 | 2052 |
| reply | crear_lead_cerrar | 11 | 10 | 19762 | 14297 | 27.65% | 4146 | 2953 |
| reply | guardar_seleccion_reintentar_luego | 11 | 10 | 15094 | 9629 | 36.21% | 3209 | 2016 |
| reply | guardar_cerrar_temporalmente | 11 | 10 | 15110 | 9645 | 36.17% | 3206 | 2013 |
| reply | ofrecer_agente_humano | 11 | 7 | 14932 | 6173 | 58.66% | 3172 | 1316 |
| reply | solicitar_agente_humano | 11 | 7 | 15911 | 7152 | 55.05% | 3374 | 1518 |
| reply | informar_error_reintento | 11 | 7 | 15139 | 6380 | 57.86% | 3218 | 1362 |
| reply | reintentar | 11 | 10 | 15338 | 9873 | 35.63% | 3256 | 2063 |
| reply | resolver_consultas_informativas | 11 | 7 | 22302 | 13543 | 39.27% | 4699 | 2843 |

## Gate result

Passed: every non-classifier route shrank and current prompts contain no repeated normalized paragraphs.

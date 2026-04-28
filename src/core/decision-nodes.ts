export const decisionNodes = [
  'contacto_inicial',
  'deteccion_intencion',
  'existe_plan_guardado',
  'entrevista',
  'minimos_para_buscar',
  'aclarar_pedir_faltante',
  'usuario_responde',
  'buscar_proveedores',
  'busqueda_exitosa',
  'hay_resultados',
  'recomendar',
  'refinar_criterios',
  'usuario_elige_proveedor',
  'anadir_a_proveedores_recomendados',
  'seguir_refinando_guardar_plan',
  'continua',
  'accion_final_exitosa',
  'necesidad_cubierta',
  'crear_lead_cerrar',
  'guardar_seleccion_reintentar_luego',
  'guardar_cerrar_temporalmente',
  'informar_error_reintento',
  'reintentar',
  'consultar_faq',
] as const;

export type DecisionNode = (typeof decisionNodes)[number];

export const extractionPersistenceNodes: ReadonlySet<DecisionNode> = new Set([
  'deteccion_intencion',
  'entrevista',
  'aclarar_pedir_faltante',
  'refinar_criterios',
  'seguir_refinando_guardar_plan',
]);

export function isDecisionNode(value: string): value is DecisionNode {
  return (decisionNodes as readonly string[]).includes(value);
}


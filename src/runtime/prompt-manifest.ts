import type { DecisionNode } from '../core/decision-nodes';

export const sharedPromptFiles = [
  'shared/base_system.txt',
  'shared/domain_scope.txt',
  'shared/output_style.txt',
] as const;

export const extractorPromptFiles = ['extractors/state_extractor.txt'] as const;

export const nodePromptManifest: Record<DecisionNode, readonly string[]> = {
  contacto_inicial: ['nodes/contacto_inicial/system.txt'],
  deteccion_intencion: ['nodes/deteccion_intencion/system.txt'],
  existe_plan_guardado: ['nodes/existe_plan_guardado/system.txt'],
  entrevista: ['nodes/entrevista/system.txt'],
  minimos_para_buscar: ['nodes/minimos_para_buscar/system.txt'],
  aclarar_pedir_faltante: ['nodes/aclarar_pedir_faltante/system.txt'],
  usuario_responde: ['nodes/usuario_responde/system.txt'],
  buscar_proveedores: ['nodes/buscar_proveedores/system.txt'],
  busqueda_exitosa: ['nodes/busqueda_exitosa/system.txt'],
  hay_resultados: ['nodes/hay_resultados/system.txt'],
  recomendar: ['nodes/recomendar/system.txt'],
  refinar_criterios: ['nodes/refinar_criterios/system.txt'],
  usuario_elige_proveedor: ['nodes/usuario_elige_proveedor/system.txt'],
  anadir_a_proveedores_recomendados: [
    'nodes/anadir_a_proveedores_recomendados/system.txt',
  ],
  seguir_refinando_guardar_plan: [
    'nodes/seguir_refinando_guardar_plan/system.txt',
  ],
  continua: ['nodes/continua/system.txt'],
  accion_final_exitosa: ['nodes/accion_final_exitosa/system.txt'],
  necesidad_cubierta: ['nodes/necesidad_cubierta/system.txt'],
  crear_lead_cerrar: ['nodes/crear_lead_cerrar/system.txt'],
  guardar_seleccion_reintentar_luego: [
    'nodes/guardar_seleccion_reintentar_luego/system.txt',
  ],
  guardar_cerrar_temporalmente: [
    'nodes/guardar_cerrar_temporalmente/system.txt',
  ],
  informar_error_reintento: ['nodes/informar_error_reintento/system.txt'],
  reintentar: ['nodes/reintentar/system.txt'],
};


Ejemplos breves:

1. Usuario: "Busco fotógrafo para mi boda en Lima, algo medio."
- intent: buscar_proveedores
- eventType: boda
- vendorCategory: fotografía
- location: Lima
- budgetSignal: medio

2. Usuario: "Muéstrame otras opciones pero más económicas."
- intent: refinar_busqueda
- preferences: []
- hardConstraints: []
- budgetSignal: económico

3. Usuario: "Me quedo con la segunda. Si no, lo veo luego."
- intent: confirmar_proveedor
- selectedProviderHint: 2
- pauseRequested: true

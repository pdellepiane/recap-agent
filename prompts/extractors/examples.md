Ejemplos breves:

1. Usuario: "Quiero planear una boda en Lima, probablemente necesitaré local, catering y foto."
- intent: buscar_proveedores
- eventType: boda
- vendorCategory: null
- vendorCategories: [local, catering, fotografía]
- activeNeedCategory: null
- location: Lima
- budgetSignal: null

2. Usuario: "Empecemos por fotógrafos en Lima, de presupuesto medio."
- intent: buscar_proveedores
- eventType: null
- vendorCategory: fotografía
- vendorCategories: [fotografía]
- activeNeedCategory: fotografía
- location: Lima
- budgetSignal: medio

3. Usuario: "Muéstrame otras opciones pero más económicas para catering."
- intent: refinar_busqueda
- vendorCategory: catering
- vendorCategories: [catering]
- activeNeedCategory: catering
- preferences: []
- hardConstraints: []
- budgetSignal: económico

4. Usuario: "Me quedo con la segunda. Si no, lo veo luego."
- intent: confirmar_proveedor
- selectedProviderHint: 2
- pauseRequested: true

5. Usuario: "Quiero usar EDO para el catering."
- intent: confirmar_proveedor
- vendorCategory: catering
- activeNeedCategory: catering
- selectedProviderHint: EDO

6. Usuario: "Quiero utilizar los servicios de Carlos y también necesito catering."
- intent: confirmar_proveedor
- vendorCategories: [fotografía, catering]
- activeNeedCategory: catering
- selectedProviderHint: Carlos

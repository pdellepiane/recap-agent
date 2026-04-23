Ejemplos breves:

1. Usuario: "Quiero planear una boda en Lima, probablemente necesitaré local, catering y foto."
- intent: buscar_proveedores
- eventType: boda
- vendorCategory: null
- vendorCategories: [local, catering, fotografía]
- activeNeedCategory: null
- location: Lima
- budgetSignal: null

1b. Usuario: "Quiero planear una boda en Lima para 120 personas, todavía no sé qué proveedores necesito."
- intent: buscar_proveedores
- eventType: boda
- vendorCategory: null
- vendorCategories: []
- activeNeedCategory: null
- location: Lima
- guestRange: 101-200

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

7. Usuario: "Dame la de tablas de queso y también necesito música."
- intent: confirmar_proveedor
- vendorCategories: [música]
- activeNeedCategory: música
- selectedProviderHint: proveedor de la shortlist relacionado con tablas de queso

8. Usuario: "Me interesa la propuesta en vivo, ¿qué seguiría?"
- intent: confirmar_proveedor
- selectedProviderHint: proveedor de la shortlist relacionado con música en vivo, solo si hay una única coincidencia clara

9. Usuario: "Ok, selecciona ese."
- intent: confirmar_proveedor
- selectedProviderHint: proveedor destacado como única recomendación clara en el turno anterior

9b. Usuario: "Me quedo con la segunda opción."
- intent: confirmar_proveedor
- selectedProviderHint: 2

9c. Usuario: "Quiero la de tablas de queso."
- intent: confirmar_proveedor
- selectedProviderHint: proveedor de la shortlist cuya descripción o servicios coinciden con tablas de queso

10. Usuario: "Perfecto, puedes contactar al proveedor?"
- intent: cerrar

11. Usuario: "Y qué djs tienes?"
- intent: buscar_proveedores
- vendorCategory: música
- vendorCategories: [música]
- activeNeedCategory: música

12. Usuario: "Y de foto qué opciones hay?"
- intent: buscar_proveedores
- vendorCategory: fotografía
- vendorCategories: [fotografía]
- activeNeedCategory: fotografía

13. Usuario: "También quiero ver catering."
- intent: buscar_proveedores
- vendorCategory: catering
- vendorCategories: [catering]
- activeNeedCategory: catering

14. Usuario: "Muéstrame otras opciones".
- intent: refinar_busqueda
- vendorCategory: categoría activa ya vigente en el plan base
- activeNeedCategory: categoría activa ya vigente en el plan base

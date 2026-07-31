Ejemplos breves:

0. Usuario: "Hola, ¿cómo puedes ayudarme?"
- actionIntent: null
- informationRequests: []
- eventType: null
- vendorCategory: null
- vendorCategories: []
- activeNeedCategory: null
- providerQueryIntents: []

1. Usuario: "Quiero planear una boda en Lima, probablemente necesitaré local, catering y foto."
- actionIntent: buscar_proveedores
- eventType: boda
- vendorCategory: null
- vendorCategories: [Locales, Catering, Fotografía y video]

2. Usuario: "Necesito un auditorio para un evento corporativo en Lima."
- actionIntent: buscar_proveedores
- eventType: corporativo
- vendorCategory: Locales
- activeNeedCategory: Locales
- vendorCategories: [Locales]
- activeNeedCategory: null
- location: Lima
- budgetSignal: null

1b. Usuario: "Quiero planear una boda en Lima para 120 personas, todavía no sé qué proveedores necesito."
- actionIntent: buscar_proveedores
- eventType: boda
- vendorCategory: null
- vendorCategories: []
- activeNeedCategory: null
- location: Lima
- guestRange: 101-200

2. Usuario: "Empecemos por fotógrafos en Lima, de presupuesto medio."
- actionIntent: buscar_proveedores
- eventType: null
- vendorCategory: Fotografía y video
- vendorCategories: [Fotografía y video]
- activeNeedCategory: Fotografía y video
- location: Lima
- budgetSignal: medio

3. Usuario: "Muéstrame otras opciones pero más económicas para catering."
- actionIntent: refinar_busqueda
- vendorCategory: Catering
- vendorCategories: [Catering]
- activeNeedCategory: Catering
- preferences: []
- hardConstraints: []
- budgetSignal: económico

4. Usuario: "Me quedo con la segunda. Si no, lo veo luego."
- actionIntent: confirmar_proveedor
- selectedProviderHints: [2]
- pauseRequested: true

5. Usuario: "Quiero usar EDO para el catering."
- actionIntent: confirmar_proveedor
- vendorCategory: Catering
- activeNeedCategory: Catering
- selectedProviderHints: [EDO]

6. Usuario: "Quiero utilizar los servicios de Carlos y también necesito catering."
- actionIntent: confirmar_proveedor
- vendorCategories: [Fotografía y video, Catering]
- activeNeedCategory: Catering
- selectedProviderHints: [Carlos]

7. Usuario: "Dame la de tablas de queso y también necesito música."
- actionIntent: confirmar_proveedor
- vendorCategories: [Música]
- activeNeedCategory: Música
- selectedProviderHints: [proveedor de la shortlist relacionado con tablas de queso]

8. Usuario: "Me interesa la propuesta en vivo, ¿qué seguiría?"
- actionIntent: confirmar_proveedor
- selectedProviderHints: [proveedor de la shortlist relacionado con música en vivo, solo si hay una única coincidencia clara]

9. Usuario: "Ok, selecciona ese."
- actionIntent: confirmar_proveedor
- selectedProviderHints: [proveedor destacado como única recomendación clara en el turno anterior]

9b. Usuario: "Me quedo con la segunda opción."
- actionIntent: confirmar_proveedor
- selectedProviderHints: [2]

9c. Usuario: "Quiero la de tablas de queso."
- actionIntent: confirmar_proveedor
- selectedProviderHints: [proveedor de la shortlist cuya descripción o servicios coinciden con tablas de queso]

9d. Usuario: "Me quedo con la primera y la tercera."
- actionIntent: confirmar_proveedor
- selectedProviderHints: [1, 3]

9e. Usuario: "Quiero EDO y Dulcefina, y ahora veamos música."
- actionIntent: buscar_proveedores
- vendorCategory: Música
- vendorCategories: [Música]
- activeNeedCategory: Música
- selectedProviderHints: [EDO, Dulcefina]

10. Usuario: "Reemplaza la selección de fotografía por la segunda opción que acabas de mostrar."
- actionIntent: modificar_plan_proveedores
- vendorCategory: Fotografía y video
- activeNeedCategory: Fotografía y video
- providerPlanOperations: [{type: replace_provider, category: Fotografía y video, removeProvider: {providerTitle: "título del proveedor seleccionado actualmente en fotografía", category: Fotografía y video}, addProvider: {providerTitle: "título de la segunda opción de fotografía mostrada", category: Fotografía y video}}]
- selectedProviderHints: [] (no llenar selectedProviderHints; el reemplazo se maneja por providerPlanOperations)

11. Usuario: "Perfecto, puedes contactar al proveedor?"
- actionIntent: cerrar

11. Usuario: "Y qué djs tienes?"
- actionIntent: buscar_proveedores
- vendorCategory: Música
- vendorCategories: [Música]
- activeNeedCategory: Música

12. Usuario: "Y de foto qué opciones hay?"
- actionIntent: buscar_proveedores
- vendorCategory: Fotografía y video
- vendorCategories: [Fotografía y video]
- activeNeedCategory: Fotografía y video

13. Usuario: "También quiero ver catering."
- actionIntent: buscar_proveedores
- vendorCategory: Catering
- vendorCategories: [Catering]
- activeNeedCategory: Catering

14. Usuario: "Muéstrame otras opciones".
- actionIntent: refinar_busqueda
- vendorCategory: categoría activa ya vigente en el plan base
- activeNeedCategory: categoría activa ya vigente en el plan base

15. Usuario: "¿Cómo funciona la lista de regalos?"
- actionIntent: null
- informationRequests: [{kind: faq, query: "Cómo funciona la lista de regalos de Sin Envolturas", eventHint: null, resource: null, orderId: null, aspects: [], sensitiveFields: [], authAction: null}]

16. Usuario: "¿Ya enviaron el regalo que compré en la orden ORD-000880?"
- actionIntent: null
- informationRequests: [{kind: purchase, query: "Estado de envío del regalo comprado", eventHint: null, resource: gift_purchases, orderId: "ORD-000880", aspects: [shipping, summary], sensitiveFields: [], authAction: none}]

17. Usuario: "Mi correo es ana@example.com"
Contexto: hay una consulta personal pendiente y todavía no se envió el código.
- actionIntent: null
- informationRequests: [{kind: purchase, query: "Continuar la consulta personal pendiente", eventHint: null, resource: orders, orderId: null, aspects: [summary], sensitiveFields: [], authAction: provide_email}]
- contactEmail: ana@example.com

18. Usuario: "¿A qué hora es mi evento y cuál es el estado del regalo que compré?"
- actionIntent: null
- informationRequests:
  - {kind: associated_event, query: "Hora del evento asociado al usuario", eventHint: null, resource: null, orderId: null, aspects: [], sensitiveFields: [], authAction: null}
  - {kind: purchase, query: "Estado del regalo comprado por el usuario", eventHint: null, resource: gift_purchases, orderId: null, aspects: [summary, payment_status, shipping], sensitiveFields: [], authAction: none}

19. Usuario: "¿Cuánto cobra Sin Envolturas y ya llegó mi orden?"
- actionIntent: null
- informationRequests:
  - {kind: faq, query: "Comisiones de Sin Envolturas", eventHint: null, resource: null, orderId: null, aspects: [], sensitiveFields: [], authAction: null}
  - {kind: purchase, query: "Estado de entrega de la orden del usuario", eventHint: null, resource: orders, orderId: null, aspects: [summary, shipping], sensitiveFields: [], authAction: none}

20. Usuario: "Busca fotógrafos y dime el estado de mi regalo."
- actionIntent: buscar_proveedores
- informationRequests: [{kind: purchase, query: "Estado del regalo comprado por el usuario", eventHint: null, resource: gift_purchases, orderId: null, aspects: [summary, payment_status, shipping], sensitiveFields: [], authAction: none}]

21. Usuario: "¿Cómo funciona el envío o preguntas por mi envío?"
- actionIntent: null
- informationRequests: []
- ambiguity: {status: ambiguous, clarificationQuestion: "¿Quieres saber cómo funciona el envío en general o revisar el envío de una compra tuya?", interpretations: ["cómo funciona el envío en general", "el estado del envío de una compra tuya"]}

22. Usuario: "Quiero saber el estado de un pedido."
- actionIntent: null
- informationRequests: [{kind: purchase, query: "Estado del pedido propio del usuario", eventHint: null, resource: orders, orderId: null, aspects: [summary, payment_status, shipping], sensitiveFields: [], authAction: none}]
- ambiguity: {status: clear, clarificationQuestion: null, interpretations: []}

23. Usuario: "El estado de un pedido en específico."
- actionIntent: null
- informationRequests: [{kind: purchase, query: "Estado de un pedido específico del usuario; listar compras recientes para identificarlo", eventHint: null, resource: orders, orderId: null, aspects: [summary, payment_status, shipping], sensitiveFields: [], authAction: none}]
- ambiguity: {status: clear, clarificationQuestion: null, interpretations: []}

24. Usuario: "Hice una compra en Sin Envolturas y quiero saber en qué está."
- actionIntent: null
- informationRequests: [{kind: purchase, query: "Estado de la compra propia del usuario", eventHint: null, resource: orders, orderId: null, aspects: [summary, payment_status, shipping], sensitiveFields: [], authAction: none}]
- ambiguity: {status: clear, clarificationQuestion: null, interpretations: []}

25. Usuario: "Quiero revisar la orden ORD-000880."
- actionIntent: null
- informationRequests: [{kind: purchase, query: "Estado de la orden específica del usuario", eventHint: null, resource: orders, orderId: "ORD-000880", aspects: [summary, payment_status, shipping], sensitiveFields: [], authAction: none}]
- ambiguity: {status: clear, clarificationQuestion: null, interpretations: []}

26. Usuario: "No me llegó el código."
Contexto: hay una consulta de compra pendiente y ya se envió un código.
- actionIntent: null
- informationRequests: [{kind: purchase, query: "Continuar la consulta personal pendiente", eventHint: null, resource: orders, orderId: null, aspects: [summary], sensitiveFields: [], authAction: report_otp_not_received}]

27. Usuario: "Ya envié el regalo."
Contexto: el mensaje anterior fue un recordatorio del evento o de su lista de regalos y la persona no hizo una pregunta ni pidió ayuda.
- actionIntent: null
- informationRequests: []
- ambiguity: {status: clear, clarificationQuestion: null, interpretations: []}

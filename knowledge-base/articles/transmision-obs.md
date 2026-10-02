---
title: "¿Cómo configuro OBS Studio para hacer la transmisión desde una cámara?"
slug: transmision-obs
category: "Transmisión en vivo"
article_type: faq
tags: ["evento", "cuenta", "invitado", "proveedor", "transmisin_en_vivo"]
source_url: "https://sinenvolturas.tawk.help/article/transmision-obs"
last_updated: "Última actualización hace 9 meses"
related_topics: ["eventos", "proveedores", "cuenta-usuario", "transmisin-en-vivo"]
---

Puedes transmitir desde tu laptop o desktop usando el programa gratuito [OBS Studio](https://obsproject.com/download). 
Open Broadcaster Software (OBS) es un programa open-source multi-plataforma que la mayoría de profesionales usan y es muy fácil de conectar a Sin Envolturas. 

Usa tus accesos RTMP
En el correo de activación te enviamos los siguientes accesos que necesitarás para configurar la transmisión desde OBS Studio. Ten en cuenta que cada evento y prueba tienen un Key RTMP único.

Instala OBS Studio y conecta la transmisión
- [Descarga e instala](https://obsproject.com/download) OBS Studio en tu computadora. 
-Abra OBS Studio, omita el asistente de configuración automática
- En OBS Studio, elija Servicio: [EventLive.pro](http://eventlive.pro/) e ingrese su evento o clave de transmisión de prueba.

Agrega una cámara web a OBS Studio
- En OBS Studio Sources agrega (+) un nuevo dispositivo de captura de video

- Nómbrala y en propiedades, escoge la cámara web correspondiente y el preset apropiado (por ejemplo 1280x720).

Comienza a transmitir
- Haz click en "Start Streaming" y visualiza la transmisión en el enlace del evento. 
- Haz click en "Start Recording" para guardar la transmisión de forma local en tus archivos.
- Ten en cuenta que cada evento y prueba tienen un Key RTMP único. No te olvides de cambiarlo luego de tus pruebas o entre eventos.

Haz una prueba
Siguiendo los mismos pasos, haz una prueba con tu cámara previo al evento, de ser posible en la locación final y asegúrate que la conexión de internet sea la adecuada. 

Usa los accesos RTMP de la prueba y el enlace de visualización de la prueba que se enviaron via correo.

No todas las cámaras soportan audio y podrías necesitar un micrófono adicional para capturar el sonido. Asegúrate que el audio y video estén sincronizados.

Si la transmisión no está fluyendo bien, puede ser que la configuración esté muy pesada para la banda ancha del internet que estás usando.

No hagas una prueba solamente de una pantalla en blanco o de una presentación, prueba la transmisión real de tu cámara por al menos 10 minutos.

Verifica tu velocidad de subida entrando a [fast.com](http://fast.com/) o [speedtest.net](http://speedtest.net/)

Configuración óptima de OBS Studio
Sigue nuestra configuración recomendada para asegurar que funcione bien la transmisión. Ingresa a "Settings" y aplica las siguientes indicaciones en cada pestaña.

Pestaña de "Output"
- Bitrate: 2000-3000 Kpbs (asegúrate que sea menor que tu velocidad de subida o carga)
- Keyframe Interval: 2

Si tu computadora está sufriendo para codificar el video, usa esta configuración:
- CPU Usage Preset: veryfast (o más alto)
- Tune: zerotolerance

Pestaña "Video"
- Output Scaled Resolution: 1280x720
- Common FPS Values: 30

Pestaña "Advanced"
Si tu velocidad de subida o carga es más baja que el bitrate sugerido o es inestable, asegúrate de usar bitrate dinámico.

Revisando la barra de estado
Revisa la barra de estado mientras estás transmitiendo para asegurar que se ha configurado correctamente la transmisión y codificación. 

Barra de estado saludable:

Error de sobrecarga

Indicador de velocidad insuficiente de codificación
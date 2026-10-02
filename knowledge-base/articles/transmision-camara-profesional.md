---
title: "¿Cómo hago la transmisión desde una Cámara DSRL, laptop u otro equipo profesional?"
slug: transmision-camara-profesional
category: "Transmisión en vivo"
article_type: faq
tags: ["pago", "evento", "transmisin_en_vivo"]
source_url: "https://sinenvolturas.tawk.help/article/transmision-camara-profesional"
last_updated: "Última actualización hace 9 meses"
related_topics: ["pagos", "eventos", "transmisin-en-vivo"]
---

Para hacer la transmisión desde cualquier cámara puedes:

1) Conectar tu cámara a la computadora y hacer la transmisión con OBS Studio o programa similar
2) Usar un dispositivo switcher que pueda transmitir con OBS studio o directamente (Ej. [ATEM Mini Pro](https://www.blackmagicdesign.com/products/atemmini))
3) Considera otro dispositivo que te permita conectar varias cámaras a la vez como [SlingStudio](https://www.myslingstudio.com/Features) o [YoloBox](https://www.yololiv.com/)

Usa OBS Studio para transmitir una vez que tu cámara esté conectada
Sigue [estos pasos](https://sinenvolturas.tawk.help/article/transmision-obs) y utiliza los accesos RTMP para configurar OBS Studio para la transmisión.

Haz una prueba
Siguiendo los [pasos para usar OBS Studio](https://sinenvolturas.tawk.help/article/transmision-obs), haz una prueba con tu cámara previo al evento, de ser posible en la locación final y asegúrate que la conexión de internet sea la adecuada. 

- Usa los accesos RTMP de la prueba y el enlace de visualización de la prueba que se encuentran en la sección Transmisión en vivo de la web del evento.
- No todas las cámaras soportan audio y podrías necesitar un micrófono adicional para capturar el sonido. Asegúrate que el audio y video estén sincronizados.
- Si la transmisión no está fluyendo bien, puede ser que la configuración esté muy pesada para la banda ancha del internet que estás usando.
- No hagas una prueba solamente de una pantalla en blanco o de una presentación, prueba la transmisión real de tu cámara por al menos 10 minutos.
- Verifica tu velocidad de subida entrando a [fast.com](http://fast.com/) o [speedtest.net](http://speedtest.net/)

Dispositivos switchers
Si tu idea es transmitir de forma profesional con varias cámaras, considera tener un switcher como BlackMagic ATEM Mini que soporta 4 entradas HDMI, micro y salida USB.

La resolución de salida mínima de ATEM es de 1080p, que puede ser difícil de usar si hay una conexión de banda ancha baja en la ubicación. Considera tener una laptop con OBS Studio pre-configurado a una baja conexión de internet y 720p de transmisión como backup.

Conectando tu cámara a la computadora
Usualmente las cámaras tienen un programa para conectarse a la computadora en formato webcam. Aquí te dejamos los más comunes:

Canon
- Descarga [EOS Webcam Utility](https://www.usa.canon.com/internet/portal/us/home/support/self-help-center/eos-webcam-utility) (Windows o Mac)
- Conecta tu cámara Canon a la computadora y transmite en vivo con un software OBS

Sony
Descarga [Imaging Edge Webcam Utility](https://support.d-imaging.sony.co.jp/app/webcam/en/download/) (Windows)
- Conecta tu cámara Sony a la computadora y transmite en vivo con un software OBS

Fuji
- No se requiere ningún programa para la [Fuji X-A7 or X-T200](https://fujifilm-x.com/global/stories/fuji-guys-how-to-series-fujifilm-x-webcam-x-a7-x-t200/) con el nuevo modo webcam
- Descarga el programa [Fuji Webcam](https://fujifilm-x.com/en-us/webcam-support/) (Windows o Mac)
- Conecta tu cámara Fuji a la computadora y transmite en vivo con un software OBS

Nikon
-Descarga [Nikon Webcamera Utility](https://downloadcenter.nikonimglib.com/en/download/sw/176.html) (Windows)
- Conecta tu cámara Nikon a la computadora y transmite en vivo con un software OBS

Olympus
- Descarga [OM-D Webcam Beta](https://learnandsupport.getolympus.com/olympus-om-d-webcam-beta) (Windows o Mac)
- Conecta tu cámara Olympus a la computadora y transmite en vivo con un software OBS

Panasonic Lumix
- Descarga [Lumix Tether for Livestreaming](https://www.panasonic.com/global/consumer/lumix/lumixtether.html) (Windows o Mac)
- Conecta tu cámara Panasonic Lumix a la computadora y transmite en vivo con un software OBS

GoPro
- Conecta tu GoPro a la computadora siguiendo los pasos en [este artículo](https://community.gopro.com/t5/en/How-to-Use-Your-GoPro-as-a-Webcam/ta-p/665493). 
- Transmite en vivo con un software OBS
- Recuerda que también puedes transmitir con la GoPro desde tu celular. Mira las instrucciones aquí.

Cámaras web (como Logitech)
No necesitas ningún dispositivo o programa adicional para transmitir a través de OBS Studio.

Otras cámaras o sistemas
Si la marca de tu cámara no tiene un programa para convertir la señal a formato webcam, necesitas una tarjeta de captura HDMI=>USB (como [Elgato Camlink](https://www.amazon.com/Elgato-Cam-Link-Broadcast-Camcorder/dp/B07K3FN5MR/), Magewell, or cualquier otra).
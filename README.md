# Bula — Sistema de rutas y abastecimiento

Prototipo interactivo para visualizar corredores marítimos y simular amenazas y desvíos de barcos con cargas agroestratégicas. Incluye Control de Mando, Reportes y Sobre Bula.

**Simulación:** los buques, cargas, rutas alternativas, alertas y tiempos son ficticios o esquemáticos. No es información en tiempo real, una evaluación oficial de riesgos ni una herramienta de navegación.

## Ejecutar localmente

Los archivos son estáticos. Desde esta carpeta, ejecuta `python3 -m http.server 8000` y abre `http://localhost:8000`. Es necesario un servidor HTTP para cargar la cartografía local.

## Publicar

El proyecto se puede importar directamente en Vercel sin instalación ni compilación. El archivo `index.html` está en la raíz.

## Cartografía y dependencias

- Cartografía de [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/), de dominio público.
- [Leaflet 1.9.4](https://leafletjs.com/); licencia incluida en `vendor/LEAFLET-LICENSE.txt`.

- Red marítima y puertos de SeaRoute 1.6.0. Licencia Apache 2.0 en `vendor/SEAROUTE-LICENSE.txt`.

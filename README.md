# Flujo del Script de Follow Automático

## 0. Inicialización

-   Cargar credenciales.
-   Configuración de límites, modo aleatorio/secuencial y fuentes de
    usuarios.

## 1. Obtener lista de usuarios objetivo

### Modo secuencial

-   Lista ordenada: seguidores de un perfil, hashtag, etc.

### Modo aleatorio

-   Mezcla la lista o toma muestras al azar.

## 2. Filtro previo

-   Verificar si ya lo sigues, si la cuenta está activa, ratio, etc.

## 3. Acción principal: FOLLOW

-   Llamada a la API.
-   Registro del usuario seguido, fecha, hora y estado.

## 4. Pausa inteligente

-   Esperas aleatorias.
-   Pausas estratégicas cada cierto número de follows.

## 5. Detección de límites

-   Manejo de errores de rate limit, bloqueos, captchas.

## 6. Loop general

    obtener_usuario -> filtrar -> seguir -> registrar -> pausa -> repetir

## 7. (Opcional) Unfollow

-   Después de 24--72h, dejar de seguir a quienes no devolvieron follow.

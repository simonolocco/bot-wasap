# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Personal de Distribuidora Abasto del Campo que atiende conversaciones de WhatsApp, toma pedidos y deriva consultas a asesores humanos desde un panel autenticado.

## Product Purpose

AbastoBot centraliza la atención comercial de WhatsApp Cloud API, conserva conversaciones y permite responder manualmente, gestionar pedidos, tickets, contactos y plantillas. El éxito operativo incluye entender qué hacen los clientes dentro del bot y detectar rápidamente dónde falla la comprensión automática.

## Operating Context

Dashboard web autenticado usado durante la operación diaria. La sección Analíticas debe ayudar a revisar períodos, detectar desvíos del menú, priorizar mensajes no entendidos y mejorar la atención sin enviar mensajes ni modificar conversaciones desde esa vista.

## Capabilities and Constraints

- Backend Node.js/Express/TypeScript con PostgreSQL y frontend React/Vite.
- WhatsApp Cloud API registra mensajes entrantes y respuestas interactivas cuando están disponibles.
- La nueva sección debe distinguir personas únicas de interacciones totales y declarar con claridad cuándo un dato histórico no puede reconstruirse por falta de eventos persistidos.
- La interfaz debe conservar el sistema visual actual, funcionar en desktop y mobile, y ofrecer estados de carga, vacío y error.
- No inventar métricas ni datos: toda cifra debe provenir de consultas o eventos verificables.

## Brand Commitments

Nombre AbastoBot, panel operativo en español, identidad visual esmeralda y superficie clara/oscura ya existente.

## Evidence on Hand

- Repositorio canónico: `C:\Users\simon\Desktop\Cliente - Camiones y VPS\bot-db-vps`.
- Producción: `https://abasto-bot.cloud`.
- Memoria compartida del proyecto: `C:\Users\simon\Desktop\CodexVualt\Proyectos\_Inbox\abastobot`.

## Product Principles

1. Las métricas deben servir para actuar sobre la atención y el bot.
2. Personas únicas e interacciones totales se muestran por separado.
3. Los mensajes no entendidos se pueden inspeccionar sin ocultar su texto original.
4. La analítica debe ser legible en segundos y verificable con el detalle.
5. La operación existente no debe degradarse por agregar métricas.

## Accessibility & Inclusion

Mantener navegación por teclado, foco visible, contraste suficiente, etiquetas textuales para iconos y una alternativa de tabla/lista para cualquier visualización resumida.

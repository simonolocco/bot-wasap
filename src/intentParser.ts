import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getProducts, Product } from './excelLoader';

const API_KEY = process.env.GOOGLE_GENAI_API_KEY;
const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

export type IntentAction = 'delete' | 'update' | 'add' | 'unknown';

export interface ParsedIntent {
  action: IntentAction;
  targetIndices?: number[]; // For deletes/updates
  newQty?: number;
  newGate?: string; // kg, caja, horma
  newProductMatch?: string; // e.g. "Queso Roquefort"
  reply: string; // The smart confirmation reply to the user
}

export async function parseUserCorrection(
  userText: string,
  currentItems: { name: string; qty: number; gate: string; cod: number | null; price: number }[]
): Promise<ParsedIntent> {
  if (!genAI) {
    console.warn('[intentParser] Gemini API no configurada. Usa la variable GOOGLE_GENAI_API_KEY.');
    return { action: 'unknown', reply: 'Lo siento, la inteligencia de edición está desactivada temporalmente.' };
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const systemPrompt = `Eres el "Asistente de Ventas Inteligente" de una distribuidora.
El usuario está revisando su carrito de compras y envió un mensaje para corregirlo o modificarlo.
Analiza la intención del usuario y devuelve STRICTAMENTE la acción a tomar en formato JSON puro (sin bloques markdown).

### REGLAS OBLIGATORIAS:
1. **Manejo de Correcciones (Crucial):** El usuario puede cometer errores y corregirlos en la misma frase o en la siguiente.
Si el usuario dice "8 borrar pero no borrame la 8 y 9", debes entender que la intención final prevalece.
Lógica de interpretación: Antes de ejecutar cualquier acción, analiza la oración completa. Si detectas palabras como "pero no", "mejor", "en realidad", "me equivoqué", "cambiame", ignora la instrucción anterior y quédate con la última voluntad del usuario.
2. **Comprensión de Contexto Humano:**
- Eliminación: Si el usuario dice "sacá el 5", "borrá el producto 2", "el último no lo quiero", debe mapear la acción "delete" y el índice correspondiente (0-indexado, por ende el ítem 1 es el índice 0). Si quiere el ítem "8 y 9", los targetIndices son [7, 8].
- Cantidades Relativas: Si dice "agregá 2 más al 3", sumas 2 a la cantidad existente y devuelves "update" para el target (índice 2).
- Fuzzy Search: Si pide cambiar un producto por "el queso azul", busca la mejor correspondencia de nombre.
3. **Confirmación Inteligente:** Genera un mensaje amable de "reply" para el usuario confirmando lo que vas a hacer y preguntando si desea otro cambio. Ejemplo: "Entendido, mantengo los productos 8 y 9 en el pedido. ¿Deseas hacer algún otro cambio?"

### CARRITO ACTUAL DEL USUARIO:
${currentItems.map((item, idx) => `[Índice ${idx} / Ítem N° ${idx + 1}] ${item.qty} ${item.gate} de ${item.name}`).join('\n')}

### CÓMO DEVOLVER EL JSON:
Solo devuelve un documento JSON con esta estructura exacta:
{
  "action": "delete" | "update" | "add" | "unknown",
  "targetIndices": [números de 0 a N correspondientes al "Índice", no al N° de ítem],
  "newQty": número (si actualiza o suma),
  "newGate": "kg" | "horma" | "caja" (si cambia unidad),
  "newProductMatch": "nombre de producto buscado" (si cambia de producto),
  "reply": "Tu respuesta amistosa y conversacional"
}`;

    const result = await model.generateContent([
      { text: systemPrompt },
      { text: `Mensaje del usuario: "${userText}"` }
    ]);

    const rawJson = result.response.text().replace(/^```json/m, '').replace(/```$/m, '').trim();
    
    try {
      const parsed = JSON.parse(rawJson) as ParsedIntent;
      return parsed;
    } catch (parseError) {
      console.error('[intentParser] Error parsing Gemini JSON:', rawJson, parseError);
      return {
        action: 'unknown',
        reply: 'No logré entender la corrección. ¿Podrías intentar expresarlo de otra forma o usar los números de los ítems?'
      };
    }
  } catch (apiError) {
    console.error('[intentParser] API generation error:', apiError);
    return {
      action: 'unknown',
      reply: 'El asistente se encuentra temporalmente ocupado, intentá la corrección usando los botones o reformulándolo más simple.'
    };
  }
}

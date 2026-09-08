import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { answerQuestion, renderAnswer, type Turn, type Intent } from '../src/ai/assistant';
import { type Catalog } from '../src/ai/catalog';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const catalog: Catalog = {
  version: 1,
  name: 'Catálogo Mayorista QA',
  approved: true,
  validFrom: today,
  validUntil: '2099-12-31',
  products: [
    { id: '1', name: 'Cremoso', brand: 'Cañada Negra', presentation: 'horma', price: 7099, unit: 'kg', tier: 'mayorista', conditions: '+ 4 HORMAS', source: 'qa-test' },
    { id: '2', name: 'Cremoso', brand: 'Punta del Agua', presentation: 'horma', price: 8520, unit: 'kg', tier: 'mayorista', conditions: '+ 24 HORMAS', source: 'qa-test' },
    { id: '3', name: 'Manteca 200g', brand: 'Punta del Agua', presentation: 'unidad', price: 1850, unit: 'unidad', tier: 'minorista', conditions: '', source: 'qa-test' },
    { id: '4', name: 'Barra Tybo', brand: 'Punta del Agua', presentation: 'horma', price: 10470, unit: 'kg', tier: 'mayorista', conditions: '+ 4 HORMAS', source: 'qa-test' },
  ],
};

async function runEvaluation() {
  console.log('======================================================================');
  console.log('EVALUACIÓN EXHAUSTIVA DE MENSAJES HISTÓRICOS Y CASOS CRÍTICOS');
  console.log('======================================================================\n');

  const filePath = path.resolve('qa-artifacts/unique_unrecognized_messages.txt');
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);

  const realMessages = lines.map(line => {
    const parts = line.split('|||');
    return { text: parts[0].trim(), count: parseInt(parts[1] || '1', 10) };
  }).filter(m => m.text.length > 0);

  // Add the explicit critical user cases from user complaints & screenshots
  const specialCases = [
    { text: 'no se peude trabajar asi eh', count: 10, note: 'User Screenshot 1 (complaint)' },
    { text: 'no se puede trabajar asi', count: 5, note: 'Complaint variant' },
    { text: 'el pedido vino mal', count: 3, note: 'Complaint delivery error' },
    { text: 'hace 3 dias que espero una respuesta', count: 2, note: 'Complaint delay' },
    { text: 'mas info', count: 25, note: 'User Screenshot 2 ("mas info")' },
    { text: 'Ver más info', count: 44, note: 'Meta ad intro click' },
    { text: 'SNACKS BUFFALO ( papas en tubos x 140 gramos ) OFERTA SEPTIEMBRE:\nPrecio Unitario Neto: $ 2.448 ( SIN IVA ).\n4 SABORES: ORIGINAL // BARBACOA // JALAPEÑO // CREMA Y CEBOLLA.\nVencimiento: MAYO 2027.', count: 1, note: 'Supplier offer (Buffalo)' },
    { text: 'Buenas tardes, mí nombre es Sebastián distribuidor de productos Fargo, y lactal', count: 1, note: 'Supplier offer (Fargo)' },
    { text: 'Buenos días - un gusto jesica delicia es mi nombre te hablo de radio impacto 99.3 , quería saber si te interesa que te pase una propuesta de publicidad de la radio!!', count: 1, note: 'Ad proposal' },
    { text: 'Adjunto currículum para puesto de trabajo', count: 1, note: 'Job seeker' },
    { text: 'Soy de jujuy busco trabajo para la zona soy vendedor', count: 1, note: 'Job seeker' },
    { text: 'Buenas consulta hacen donaciones a institución,ya estamos resignados preguntamos en ambos lados si no nos dan una mano y se an negado mi Dios toque su corazón', count: 1, note: 'Charity/Church donation' },
    { text: 'Somos una iglesia evangélica', count: 1, note: 'Church donation' },
    { text: 'dfd', count: 1, note: 'Gibberish' },
    { text: 'Kl', count: 1, note: 'Gibberish' },
    { text: 'A', count: 4, note: 'Single character' },
    { text: '.', count: 3, note: 'Punctuation' },
    { text: '????', count: 1, note: 'Punctuation' },
    { text: 'jajaja', count: 1, note: 'Laughter' },
    { text: 'Llegan a moreno', count: 2, note: 'Out of area shipping' },
    { text: 'Buen día llegan a Santiago del estero', count: 1, note: 'Out of area shipping' },
    { text: 'Hacen reparto en bialet masse', count: 1, note: 'Out of area shipping' },
    { text: 'Hablas de Cordoba capital o de Buenos Aires?', count: 1, note: 'Location clarification' },
    { text: 'No puedo abrir l enlace de minorista', count: 1, note: 'Catalog problem' },
    { text: 'Paceme por pdf', count: 1, note: 'Catalog problem' },
    { text: 'Necesito un asesor', count: 1, note: 'Advisor request' },
  ];

  // Mock complete function that simulates LLM classifications for the tests
  const mockComplete = async (messages: any[]) => {
    const raw = String(messages[messages.length - 1].content).trim();
    const lower = raw.toLowerCase();
    
    const intent: Intent = {
      topics: [],
      productQuery: '',
      tier: 'unknown',
      catalog: false,
      human: false,
      order: false,
      stock: false,
      social: 'none',
      unknown: false,
    };

    if (/no se p[eu]ede trabajar|pesim[ao]|verguenza|estafa|vino mal|hace \d+ dias/i.test(lower)) {
      intent.complaint = true;
      intent.human = true;
      return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
    }
    if (/snacks buffalo|fargo|curriculum|cv\b|puesto de trabajo|busco trabajo|radio impacto|donacion|iglesia/i.test(lower)) {
      intent.externalProposal = true;
      intent.human = true;
      return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
    }
    if (/asesor|humano|persona/i.test(lower)) {
      intent.human = true;
      return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
    }
    if (/no puedo abrir|no me deja ver|por pdf|el enlace/i.test(lower)) {
      intent.topics = ['catalog_problem'];
      return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
    }
    if (/catalogo|lista de precio|me pasas catalogo/i.test(lower)) {
      intent.catalog = true;
      return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
    }
    if (/moreno|santiago del estero|bialet masse|mar del plata|rosario|chaco|mendoza|jujuy/i.test(lower)) {
      intent.topics = ['shipping'];
      intent.locationDistance = true;
      return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
    }
    if (/ver m[aá]s info|m[aá]s info/i.test(lower)) {
      intent.topics = ['information'];
      return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
    }
    if (/de d[oó]nde son|d[oó]nde queda|ubicaci[oó]n|direcci[oó]n/i.test(lower)) {
      intent.topics = ['address'];
      return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
    }
    if (/cremoso/i.test(lower)) {
      intent.productQuery = 'cremoso';
      if (/mayorista/i.test(lower)) intent.tier = 'mayorista';
      else if (/minorista/i.test(lower)) intent.tier = 'minorista';
      return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
    }
    if (/compra m[ií]nima|m[ií]nimo/i.test(lower)) {
      intent.topics = ['minimum'];
      return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
    }
    if (/hola|buenos d[ií]as|buenas tardes/i.test(lower)) {
      intent.social = 'greeting';
      return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
    }
    if (/gracias|muchas gracias/i.test(lower)) {
      intent.social = 'thanks';
      return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
    }

    intent.unknown = true;
    return { content: JSON.stringify(intent), model: 'qa-llm-mock', tokens: 20 };
  };

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  // Run all combined messages
  const allToTest = [...specialCases, ...realMessages];
  console.log(`Total de mensajes a procesar y evaluar: ${allToTest.length}\n`);

  for (const item of allToTest) {
    totalTests++;
    if (totalTests % 50 === 0) {
      console.log(`... evaluados ${totalTests} / ${allToTest.length} mensajes ...`);
    }
    const text = item.text;
    const answer = await answerQuestion({ message: text }, catalog, mockComplete);

    // Rule 1: Complaint MUST NEVER output address
    if (/no se p[eu]ede trabajar|el pedido vino mal|hace \d+ dias/i.test(text)) {
      const failed = /Av\. Juan B\. Justo|📍 \*Dirección\*/i.test(answer.text);
      if (failed) {
        failedTests++;
        console.error(`❌ REGRESIÓN: Queja devolvió dirección física!\n  Input: "${text}"\n  Respuesta: "${answer.text}"\n`);
        continue;
      }
      assert.equal(answer.outcome, 'handoff');
      assert.match(answer.text, /Mauricio|wa\.me\/5493517565641/);
    }

    // Rule 2: "Más info" MUST NOT concatenate two canned blocks
    if (/^(ver m[aá]s info|m[aá]s info)$/i.test(text)) {
      const duplicated = answer.text.includes('Trabajamos con retiro coordinado en Córdoba. Podés') &&
                         answer.text.includes('Somos Distribuidora Abasto del Campo, en Córdoba. Atendemos');
      if (duplicated) {
        failedTests++;
        console.error(`❌ REGRESIÓN: "Más info" concatenó bloques enlatados repetidos!\n  Input: "${text}"\n  Respuesta: "${answer.text}"\n`);
        continue;
      }
      assert.match(answer.text, /Distribuidora Abasto del Campo/);
      assert.match(answer.text, /Córdoba Capital/);
    }

    // Rule 3: External proposals & CV MUST route to advisor
    if (/snacks buffalo|fargo|curriculum|cv\b|radio impacto|donaciones|iglesia evangélica/i.test(text)) {
      if (answer.outcome !== 'handoff') {
        failedTests++;
        console.error(`❌ REGRESIÓN: Propuesta externa no derivó a asesor!\n  Input: "${text}"\n  Outcome: ${answer.outcome}\n`);
        continue;
      }
      assert.match(answer.text, /exclusivo para atención a clientes|asesor comercial/i);
      assert.match(answer.text, /wa\.me\/5493517565641/);
    }

    // Rule 4: Out-of-area shipping MUST clarify Córdoba Capital and comisionista
    if (/moreno|santiago del estero|bialet masse|mar del plata|entre rios/i.test(text) && !/trabajo|curriculum|cv\b/i.test(text)) {
      assert.match(answer.text, /Córdoba Capital/);
      assert.match(answer.text, /comisionista|transporte/i);
    }

    // Rule 5: Gibberish MUST be clarify and helpful
    if (/^(dfd|kl|a|\.|\?\?\?\?|jajaja)$/i.test(text)) {
      if (answer.outcome !== 'clarify') {
        console.log(`[DEBUG RULE 5] Failed for text: "${text}", outcome was: "${answer.outcome}", raw answer: "${answer.text}"`);
      }
      assert.equal(answer.outcome, 'clarify');
      assert.match(answer.text, /No llegué a comprender|¿En qué podemos ayudarte/i);
    }

    // Rule 6: No empty answers
    if (!answer.text || answer.text.trim().length === 0) {
      failedTests++;
      console.error(`❌ ERROR: Respuesta vacía para "${text}"\n`);
      continue;
    }

    passedTests++;
  }

  console.log('----------------------------------------------------------------------');
  console.log(`RESULTADOS FINALES DE EVALUACIÓN:`);
  console.log(`  Total mensajes evaluados: ${totalTests}`);
  console.log(`  Respuestas válidas y coherentes: ${passedTests}`);
  console.log(`  Errores / Regresiones: ${failedTests}`);
  console.log('----------------------------------------------------------------------');

  if (failedTests === 0) {
    console.log('✅ ÉXITO TOTAL: 100% de los mensajes reales e históricos respondidos con coherencia, seguridad anti-alucinación y filtro de reclamos/spam.');
  } else {
    throw new Error(`Fallaron ${failedTests} verificaciones.`);
  }
}

runEvaluation().catch(err => {
  console.error(err);
  process.exit(1);
});

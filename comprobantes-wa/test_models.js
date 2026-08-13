import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.OPENROUTER_API_KEY;
const imagePath = 'C:\\Users\\simon\\Desktop\\invoice\\media\\20260722_160653_244551243538579_AC723B9D85D5B868B9C418126001D932_image.jpg';

const fileBytes = fs.readFileSync(imagePath);
const fileB64 = fileBytes.toString('base64');

const modelsToTest = [
    'google/gemini-2.5-flash',
    'google/gemini-2.0-flash-001',
    'google/gemini-flash-1.5',
    'qwen/qwen-2.5-vl-72b-instruct:free',
    'meta-llama/llama-3.2-11b-vision-instruct:free'
];

async function testModel(model) {
    console.log(`\n-----------------------------------`);
    console.log(`Testing model: ${model}`);
    
    const payload = {
        model,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `Analiza esta imagen de comprobante de pago y extrae la fecha exacta y el monto numérico exacto en JSON. Ejemplo: {"fecha": "YYYY-MM-DD", "monto": 166581}`
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/jpeg;base64,${fileB64}`
                        }
                    }
                ]
            }
        ]
    };

    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok) {
            console.log(`✅ SUCCESS [${model}]:`);
            console.log(data.choices?.[0]?.message?.content);
        } else {
            console.log(`❌ ERROR [${model}]:`, data.error?.message || data);
        }
    } catch (e) {
        console.log(`❌ EXCEPTION [${model}]:`, e.message);
    }
}

async function run() {
    for (const m of modelsToTest) {
        await testModel(m);
    }
}

run();

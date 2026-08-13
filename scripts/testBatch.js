require('dotenv/config');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GOOGLE_GENAI_API_KEY;
if (!apiKey) {
  console.error('Falta GOOGLE_GENAI_API_KEY en el archivo .env');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
async function test() {
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  try {
    const result = await model.batchEmbedContents({
      requests: [
        { content: { role: 'user', parts: [{ text: "Hello" }] } },
        { content: { role: 'user', parts: [{ text: "World" }] } }
      ]
    });
    console.log('OK! Vectors:', result.embeddings.length);
  } catch (err) {
    console.error('FAIL:', err.message);
  }
}
test();

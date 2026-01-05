import axios, { AxiosError } from 'axios';

const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const CLOUD_TOKEN = process.env.WHATSAPP_CLOUD_TOKEN;

export function hasCloudCredentials(): boolean {
  return Boolean(PHONE_ID && CLOUD_TOKEN);
}

export async function sendCloudMessage(payload: Record<string, unknown>) {
  if (!PHONE_ID || !CLOUD_TOKEN) {
    throw new Error('Falta configurar WHATSAPP_PHONE_ID o WHATSAPP_CLOUD_TOKEN');
  }
  try {
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${CLOUD_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: { message?: string; type?: string; code?: number } }>;
    if (axiosError.response) {
      console.error('[cloud-client] Error response body:', axiosError.response.data);
    } else {
      console.error('[cloud-client] Error sin respuesta de WhatsApp:', axiosError.message);
    }
    throw error;
  }
}


export async function sendCloudTextMessage(to: string, body: string) {
  console.log(`[cloud-client] Enviando mensaje a ${to}: ${body}`);
  await sendCloudMessage({
    messaging_product: 'whatsapp',
    to,
    text: { body },
  });
}

export async function sendCloudAudio(to: string, audioUrl: string, caption?: string) {
  console.log(`[cloud-client] Enviando audio a ${to}: ${audioUrl}`);
  await sendCloudMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'audio',
    audio: {
      link: audioUrl,
    },
  });
}

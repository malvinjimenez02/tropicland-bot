const axios = require('axios');

const BASE_URL = `https://graph.facebook.com/v19.0/${process.env.META_PHONE_NUMBER_ID}/messages`;

const headers = () => ({
  Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
});

async function sendTextMessage(to, text) {
  try {
    const response = await axios.post(
      BASE_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      { headers: headers() }
    );
    console.log(`Mensaje enviado a ${to}: ${text.substring(0, 50)}...`);
    return response.data;
  } catch (err) {
    console.error(`Error enviando mensaje a ${to}:`, err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendTextMessage };

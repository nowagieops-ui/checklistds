const axios = require('axios');

async function sendWhatsApp(message) {
  const phone = process.env.CALLMEBOT_PHONE;
  const apiKey = process.env.CALLMEBOT_API_KEY;

  if (!phone || !apiKey || apiKey === 'your-callmebot-api-key') {
    console.log('[WhatsApp skipped - not configured]:', message);
    return;
  }

  try {
    const encoded = encodeURIComponent(message);
    await axios.get(
      `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${apiKey}`
    );
    console.log('WhatsApp notification sent');
  } catch (err) {
    console.error('WhatsApp notification failed:', err.message);
  }
}

module.exports = { sendWhatsApp };

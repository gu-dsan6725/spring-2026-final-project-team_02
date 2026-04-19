import Groq from 'groq-sdk';
const origFetch = globalThis.fetch;
globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
  console.log('FETCHING:', url.toString());
  return origFetch(url, init);
};
const client = new Groq({
  apiKey: process.env['OPENAI_API_KEY'],
  baseURL: 'https://api.openai.com',
});
client.chat.completions
  .create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 5,
  })
  .then((r) => console.log('OK'))
  .catch((e: Error) => console.log('ERR'));

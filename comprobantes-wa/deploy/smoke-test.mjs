const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';

const loginResponse = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
        username: process.env.APP_USERNAME,
        password: process.env.APP_PASSWORD
    })
});

console.log(`loginStatus=${loginResponse.status}`);

const cookie = (loginResponse.headers.get('set-cookie') || '').split(';')[0];
const checks = [
    ['receipts', '/api/receipts?days=3650'],
    ['reconciliations', '/api/reconciliations'],
    ['config', '/api/config']
];

for (const [label, path] of checks) {
    const response = await fetch(`${baseUrl}${path}`, {
        headers: { cookie }
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        // The status is still useful when a response body is not JSON.
    }

    const count = Array.isArray(payload) ? payload.length : 'object';
    console.log(`${label}Status=${response.status} ${label}Count=${count}`);
}

const socketResponse = await fetch(
    `${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
    { headers: { cookie } }
);
const socketPayload = await socketResponse.text();
const socketReady = socketResponse.ok && socketPayload.startsWith('0');
console.log(`realtimeStatus=${socketResponse.status} realtimeReady=${socketReady}`);

const whatsappResponse = await fetch(`${baseUrl}/api/whatsapp/status`, {
    headers: { cookie }
});
const whatsapp = await whatsappResponse.json();
console.log(
    `whatsappStatus=${whatsapp.status || 'unknown'} ` +
    `whatsappGroups=${Array.isArray(whatsapp.groups) ? whatsapp.groups.length : 0}`
);

if (!loginResponse.ok || !socketReady || whatsapp.status !== 'open') {
    process.exitCode = 1;
}

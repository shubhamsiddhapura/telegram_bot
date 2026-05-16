const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

async function test() {
    console.log('TEST START');
    const { state, saveCreds } = await useMultiFileAuthState('./test-session');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        console.log('CONNECTION UPDATE:', { connection, qr: !!qr });
        if (qr) {
            console.log('QR RECEIVED!');
        }
    });
}
test().catch(console.error);

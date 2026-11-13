/** sendMailAs mot en liten SMTP-server: vi skal vite om e-posten kan ha gått før forbindelsen brøt. */
import net from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { sendMailAs, type MailSendError } from '@/lib/mail';

type Mode = 'ok' | 'close-at-rcpt' | 'close-after-dot' | 'reject-data' | 'reject-rcpt-5xx';
let server: net.Server;
let received = 0;

function start(mode: Mode): Promise<number> {
  server = net.createServer((socket) => {
    socket.write('220 test\r\n');
    let inData = false;
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line !== '.') continue;
          inData = false;
          if (mode === 'close-after-dot') return socket.destroy();
          received++;
          socket.write('250 2.0.0 queued\r\n');
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') socket.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (cmd === 'AUTH') socket.write('235 ok\r\n');
        else if (cmd === 'RCPT' && mode === 'close-at-rcpt') return socket.destroy();
        else if (cmd === 'RCPT' && mode === 'reject-rcpt-5xx') socket.write('550 5.1.1 User unknown\r\n');
        else if (cmd === 'DATA' && mode === 'reject-data') socket.write('451 4.7.0 Try again later\r\n');
        else if (cmd === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (cmd === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)));
}

const input = { from: { name: 'Hilde', address: 'hilde@bjerke.no' }, to: 'kari@example.com', subject: 'Hei', html: '<p>Hei Kari</p>' };

async function sendWith(mode: Mode) {
  process.env.SMTP_PORT = String(await start(mode));
  return sendMailAs(input).then(
    (r) => ({ ok: r, error: null }),
    (e: MailSendError) => ({ ok: null, error: e }),
  );
}

beforeEach(() => {
  received = 0;
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_USER = 'u';
  process.env.SMTP_PASS = 'p';
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

describe('sendMailAs', () => {
  it('sender og gir tilbake Message-ID', async () => {
    const { ok } = await sendWith('ok');
    expect(ok?.messageId).toMatch(/^<.+@.+>$/);
    expect(received).toBe(1);
  });

  it('brudd før e-posten begynte å gå: ikke levert, trygt å prøve igjen', async () => {
    const { error } = await sendWith('close-at-rcpt');
    expect(error?.code).toBe('ECONNECTION');
    expect(error?.mayHaveBeenDelivered).toBe(false);
  });

  it('brudd etter at e-posten gikk, uten svar: kan være levert, skal ikke sendes igjen', async () => {
    const { error } = await sendWith('close-after-dot');
    expect(error?.mayHaveBeenDelivered).toBe(true);
  });

  it('serveren avviser med svar: ikke levert', async () => {
    const data = await sendWith('reject-data');
    expect(data.error?.responseCode).toBe(451);
    expect(data.error?.mayHaveBeenDelivered).toBe(false);
    await new Promise<void>((r) => server.close(() => r()));
    const rcpt = await sendWith('reject-rcpt-5xx');
    expect(rcpt.error?.responseCode).toBe(550);
    expect(rcpt.error?.mayHaveBeenDelivered).toBe(false);
  });
});

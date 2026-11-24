import { MockOtpSender } from './mock-otp.sender';
import { OtpDeliveryError } from './otp-sender';
import { TwilioOtpSender } from './twilio-otp.sender';

describe('OTP senders', () => {
  it('mock sender expects the configured code and never exposes it in deliveries', async () => {
    const s = new MockOtpSender('123456');
    expect(s.fixedCode()).toBe('123456');
    await s.send({ phoneE164: '+919876543210', code: '123456', ttlSeconds: 300 });
    expect(s.deliveries).toHaveLength(1);
    expect(JSON.stringify(s.deliveries)).not.toContain('123456');
  });

  describe('Twilio', () => {
    const cfg = {
      accountSid: 'AC123',
      authToken: 'secret',
      fromNumber: '+15550001111',
      timeoutMs: 1000,
    };

    it('posts the SMS with basic auth and generates random codes (no fixed code)', async () => {
      const f = jest.fn().mockResolvedValue(new Response('{}', { status: 201 }));
      const s = new TwilioOtpSender(cfg, f);
      expect(s.fixedCode()).toBeNull();
      await s.send({ phoneE164: '+919876543210', code: '481516', ttlSeconds: 300 });
      const [url, init] = f.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `Basic ${Buffer.from('AC123:secret').toString('base64')}`,
      );
      const body = new URLSearchParams(init.body as string);
      expect(body.get('To')).toBe('+919876543210');
      expect(body.get('Body')).toContain('481516');
      expect(body.get('Body')).toContain('5 minutes');
    });

    it('classifies provider errors as retryable or not', async () => {
      const s500 = new TwilioOtpSender(
        cfg,
        jest.fn().mockResolvedValue(new Response('', { status: 503 })),
      );
      await expect(
        s500.send({ phoneE164: '+91', code: '1', ttlSeconds: 60 }),
      ).rejects.toMatchObject({ retryable: true });
      const s400 = new TwilioOtpSender(
        cfg,
        jest.fn().mockResolvedValue(new Response('', { status: 400 })),
      );
      await expect(
        s400.send({ phoneE164: '+91', code: '1', ttlSeconds: 60 }),
      ).rejects.toMatchObject({ retryable: false });
      const sNet = new TwilioOtpSender(cfg, jest.fn().mockRejectedValue(new Error('ECONNRESET')));
      await expect(
        sNet.send({ phoneE164: '+91', code: '1', ttlSeconds: 60 }),
      ).rejects.toBeInstanceOf(OtpDeliveryError);
    });
  });
});

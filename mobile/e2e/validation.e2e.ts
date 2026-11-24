import { by, device, element, expect, waitFor } from 'detox';

const T = 30_000;

describe('EmblemWay: validation and error handling', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true });
    await waitFor(element(by.id('welcome-screen'))).toBeVisible().withTimeout(120_000);
  });

  it('rejects an invalid mobile number without calling the server', async () => {
    await element(by.id('login-mobile')).replaceText('12345');
    await element(by.id('login-submit')).tap();
    await expect(element(by.text('Enter a valid 10-digit Indian mobile number'))).toBeVisible();
  });

  it('rejects a wrong OTP and shows remaining attempts', async () => {
    await element(by.id('login-mobile')).replaceText(`8${String(Date.now()).slice(-9)}`);
    await element(by.id('login-submit')).tap();
    await waitFor(element(by.id('otp-screen'))).toBeVisible().withTimeout(T);
    await element(by.id('otp-code')).replaceText('000000');
    await element(by.id('otp-submit')).tap();
    await waitFor(element(by.text('That code is incorrect. 4 attempts left.'))).toBeVisible().withTimeout(T);
  });
});

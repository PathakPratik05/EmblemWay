import { by, device, element, expect, waitFor } from 'detox';

/**
 * End-to-end flow on an Android emulator against a locally running EmblemWay backend
 * (OTP_PROVIDER=mock with MOCK_OTP_CODE=123456, MAPS_PROVIDER=mock or google).
 */
const OTP = process.env.E2E_OTP ?? '123456';
const phone = `9${String(Date.now()).slice(-9)}`;
const T = 30_000;

async function visible(id: string, timeout = T) {
  await waitFor(element(by.id(id))).toBeVisible().withTimeout(timeout);
}

async function scrollTo(id: string, scrollView: string) {
  await waitFor(element(by.id(id))).toBeVisible().whileElement(by.id(scrollView)).scroll(250, 'down');
}

async function choosePlace(fieldId: string, query: string, suggestionId: string) {
  await element(by.id(fieldId)).tap();
  await visible('place-search-input');
  await element(by.id('place-search-input')).replaceText(query);
  await visible(suggestionId);
  await element(by.id(suggestionId)).tap();
}

describe('EmblemWay: register → plan → match → traffic → history → logout', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true, permissions: { location: 'never', notifications: 'NO' } });
  });

  it('registers a new account with OTP', async () => {
    await visible('welcome-screen', 120_000);
    await element(by.id('go-register')).tap();
    await element(by.id('register-firstName')).replaceText('Esha');
    await element(by.id('register-lastName')).replaceText('Tester');
    await element(by.id('register-mobileNumber')).replaceText(phone);
    await element(by.id('register-submit')).tap();
    await visible('otp-screen');
    await element(by.id('otp-code')).replaceText(OTP);
    await element(by.id('otp-submit')).tap();
  });

  it('completes profile setup', async () => {
    await visible('profile-setup-screen');
    await visible('vehicle-CAR');
    await element(by.id('vehicle-CAR')).tap();
    await element(by.id('profile-submit')).tap();
    await visible('home-screen');
  });

  it('plans a journey with place search and the map planner', async () => {
    await choosePlace('home-source', 'Hinjewadi', 'suggestion-mock-hinjewadi-ph1');
    await visible('home-screen');
    await choosePlace('home-destination', 'Kharadi', 'suggestion-mock-kharadi');
    await visible('home-screen');
    await scrollTo('search-journeys', 'home-screen');
    await element(by.id('search-journeys')).tap();
    await visible('map-planner-screen');
    await visible('route-distance');
    await element(by.id('save-journey')).tap();
    await visible('journey-detail-screen');
    await expect(element(by.text('Planned'))).toBeVisible();
  });

  it('shows travellers on the route with honest counts', async () => {
    await scrollTo('open-matches', 'journey-detail-screen');
    await element(by.id('open-matches')).tap();
    await visible('route-matching-screen');
    await visible('stat-travellers');
    await scrollTo('match-disclaimer', 'route-matching-screen');
    await device.pressBack();
  });

  it('shows traffic estimates for five departure times', async () => {
    await scrollTo('open-traffic', 'journey-detail-screen');
    await element(by.id('open-traffic')).tap();
    await visible('traffic-screen');
    await visible('traffic-recommendation');
    for (const s of ['NOW', 'PLUS_15_MINUTES', 'PLUS_30_MINUTES', 'PLUS_45_MINUTES', 'PLUS_60_MINUTES']) {
      await scrollTo(`traffic-${s}`, 'traffic-screen');
    }
    await scrollTo('traffic-disclaimer', 'traffic-screen');
    await device.pressBack();
  });

  it('cancels the journey and finds it in history', async () => {
    await scrollTo('cancel-journey', 'journey-detail-screen');
    await element(by.id('cancel-journey')).tap();
    await element(by.text('CANCEL JOURNEY')).tap();
    await waitFor(element(by.text('Cancelled'))).toBeVisible().withTimeout(T);
    await device.pressBack();
    await element(by.id('tab-Journeys')).tap();
    await visible('journeys-screen');
    await element(by.id('tab-history')).tap();
    await waitFor(element(by.text('Cancelled')).atIndex(0)).toBeVisible().withTimeout(T);
  });

  it('logs out and logs back in as an existing user', async () => {
    await element(by.id('tab-Profile')).tap();
    await visible('profile-screen');
    await scrollTo('logout-button', 'profile-screen');
    await element(by.id('logout-button')).tap();
    await visible('welcome-screen');
    await element(by.id('login-mobile')).replaceText(phone);
    await element(by.id('login-submit')).tap();
    await visible('otp-screen');
    await element(by.id('otp-code')).replaceText(OTP);
    await element(by.id('otp-submit')).tap();
    await visible('home-screen');
  });
});

import {
  createAdmin,
  createTestApp,
  MOCK_OTP,
  registerUser,
  resetDatabase,
  TestContext,
  uniquePhone,
  auth,
} from '../utils/test-app';

describe('Authentication (integration, real PostgreSQL)', () => {
  let ctx: TestContext;
  const api = '/api/v1';

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => resetDatabase(ctx));
  afterAll(async () => ctx.close());

  function requestOtp(phone: string) {
    return ctx
      .http()
      .post(`${api}/auth/otp/request`)
      .send({ countryCode: '+91', mobileNumber: phone });
  }

  it('registers a new user end-to-end and persists hashed OTP only', async () => {
    const phone = uniquePhone();
    const otp = await requestOtp(phone).expect(200);
    expect(otp.body).toMatchObject({ requestId: expect.any(String), codeLength: 6 });

    const row = await ctx.prisma.otpVerification.findUniqueOrThrow({
      where: { id: otp.body.requestId },
    });
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toContain(MOCK_OTP);

    const res = await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({
        requestId: otp.body.requestId,
        code: MOCK_OTP,
        firstName: 'Priya',
        lastName: 'Kulkarni',
      })
      .expect(200);
    expect(res.body).toMatchObject({
      isNewUser: true,
      profileComplete: false,
      user: { firstName: 'Priya', role: 'USER' },
      tokens: { tokenType: 'Bearer' },
    });

    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: res.body.user.id },
      include: { profile: true },
    });
    expect(user.phoneE164).toBe(`+91${phone}`);
    expect(user.profile).not.toBeNull();

    const me = await ctx
      .http()
      .get(`${api}/users/me`)
      .set(auth(res.body.tokens.accessToken))
      .expect(200);
    expect(me.body.mobileNumberMasked).toBe(`+91 ••••••${phone.slice(-4)}`);
    expect(JSON.stringify(me.body)).not.toContain(phone);
  });

  it('logs in an existing user without names', async () => {
    const u = await registerUser(ctx, 'Arjun', 'Rao');
    const otp = await requestOtp(u.phone).expect(200);
    const res = await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({ requestId: otp.body.requestId, code: MOCK_OTP })
      .expect(200);
    expect(res.body).toMatchObject({ isNewUser: false, user: { id: u.userId } });
  });

  it('requires names for unknown numbers WITHOUT consuming the code', async () => {
    const otp = await requestOtp(uniquePhone()).expect(200);
    const first = await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({ requestId: otp.body.requestId, code: MOCK_OTP })
      .expect(422);
    expect(first.body.error.code).toBe('REGISTRATION_DETAILS_REQUIRED');
    await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({ requestId: otp.body.requestId, code: MOCK_OTP, firstName: 'N', lastName: 'M' })
      .expect(200);
  });

  it.each(['12345', '98765', '5876543210', '+449876543210'])(
    'rejects invalid Indian mobile number %s',
    async (n) => {
      const res = await requestOtp(n).expect((r) => expect([400]).toContain(r.status));
      expect(res.body.error.code).toMatch(/INVALID_PHONE_NUMBER|VALIDATION_FAILED/);
    },
  );

  it('rejects unsupported country codes', async () => {
    const res = await ctx
      .http()
      .post(`${api}/auth/otp/request`)
      .send({ countryCode: '+1', mobileNumber: '2025550123' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_PHONE_NUMBER');
  });

  it('counts invalid attempts, reports remaining attempts and locks the code', async () => {
    const otp = await requestOtp(uniquePhone()).expect(200);
    for (let i = 1; i <= 4; i += 1) {
      const r = await ctx
        .http()
        .post(`${api}/auth/otp/verify`)
        .send({ requestId: otp.body.requestId, code: '000000', firstName: 'A', lastName: 'B' })
        .expect(400);
      expect(r.body.error).toMatchObject({
        code: 'OTP_INVALID',
        details: { remainingAttempts: 5 - i },
      });
    }
    const fifth = await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({ requestId: otp.body.requestId, code: '000000' })
      .expect(429);
    expect(fifth.body.error.code).toBe('OTP_LOCKED');
    // Even the correct code is refused once locked (brute force protection).
    const correct = await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({ requestId: otp.body.requestId, code: MOCK_OTP, firstName: 'A', lastName: 'B' })
      .expect(429);
    expect(correct.body.error.code).toBe('OTP_LOCKED');
  });

  it('concurrent wrong guesses can never exceed the attempt limit', async () => {
    const otp = await requestOtp(uniquePhone()).expect(200);
    await Promise.all(
      Array.from({ length: 12 }, () =>
        ctx
          .http()
          .post(`${api}/auth/otp/verify`)
          .send({ requestId: otp.body.requestId, code: '111111' }),
      ),
    );
    const row = await ctx.prisma.otpVerification.findUniqueOrThrow({
      where: { id: otp.body.requestId },
    });
    expect(row.attempts).toBe(5);
    expect(row.lockedAt).not.toBeNull();
  });

  it('expires codes after the TTL', async () => {
    const otp = await requestOtp(uniquePhone()).expect(200);
    await ctx.prisma.otpVerification.update({
      where: { id: otp.body.requestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const r = await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({ requestId: otp.body.requestId, code: MOCK_OTP, firstName: 'A', lastName: 'B' })
      .expect(400);
    expect(r.body.error.code).toBe('OTP_EXPIRED');
  });

  it('prevents OTP replay', async () => {
    const phone = uniquePhone();
    const otp = await requestOtp(phone).expect(200);
    await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({ requestId: otp.body.requestId, code: MOCK_OTP, firstName: 'A', lastName: 'B' })
      .expect(200);
    const replay = await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({ requestId: otp.body.requestId, code: MOCK_OTP })
      .expect(400);
    expect(replay.body.error.code).toBe('OTP_ALREADY_USED');
  });

  it('only one of two simultaneous verifications of the same code succeeds', async () => {
    const otp = await requestOtp(uniquePhone()).expect(200);
    const body = { requestId: otp.body.requestId, code: MOCK_OTP, firstName: 'A', lastName: 'B' };
    const results = await Promise.all([
      ctx.http().post(`${api}/auth/otp/verify`).send(body),
      ctx.http().post(`${api}/auth/otp/verify`).send(body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await ctx.prisma.user.count({ where: { role: 'USER' } })).toBe(1);
  });

  it('enforces resend cooldown and supersedes the previous code', async () => {
    const phone = uniquePhone();
    const first = await requestOtp(phone).expect(200);
    const tooSoon = await requestOtp(phone).expect(429);
    expect(tooSoon.body.error.code).toBe('OTP_RESEND_COOLDOWN');
    expect(tooSoon.headers['retry-after']).toBeDefined();

    await ctx.prisma.otpVerification.update({
      where: { id: first.body.requestId },
      data: { resendAvailableAt: new Date(Date.now() - 1000) },
    });
    const second = await requestOtp(phone).expect(200);
    const old = await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({ requestId: first.body.requestId, code: MOCK_OTP, firstName: 'A', lastName: 'B' })
      .expect(400);
    expect(old.body.error.code).toBe('OTP_EXPIRED');
    await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({ requestId: second.body.requestId, code: MOCK_OTP, firstName: 'A', lastName: 'B' })
      .expect(200);
  });

  it('caps the number of codes sent per number per hour', async () => {
    const phone = uniquePhone();
    for (let i = 0; i < 5; i += 1) {
      const r = await requestOtp(phone).expect(200);
      await ctx.prisma.otpVerification.update({
        where: { id: r.body.requestId },
        data: { resendAvailableAt: new Date(Date.now() - 1000) },
      });
    }
    const blocked = await requestOtp(phone).expect(429);
    expect(blocked.body.error.code).toBe('OTP_SEND_LIMIT');
  });

  it('rotates refresh tokens and detects reuse (revoking the whole session)', async () => {
    const u = await registerUser(ctx);
    const r1 = await ctx
      .http()
      .post(`${api}/auth/refresh`)
      .send({ refreshToken: u.refreshToken })
      .expect(200);
    expect(r1.body.refreshToken).not.toBe(u.refreshToken);

    // The new access token works.
    await ctx.http().get(`${api}/users/me`).set(auth(r1.body.accessToken)).expect(200);

    // Replaying the OLD refresh token = theft signal -> family revoked.
    const reuse = await ctx
      .http()
      .post(`${api}/auth/refresh`)
      .send({ refreshToken: u.refreshToken })
      .expect(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    // The legitimately rotated token was revoked with its family.
    const after = await ctx
      .http()
      .post(`${api}/auth/refresh`)
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
    expect(after.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    await ctx.http().get(`${api}/users/me`).set(auth(r1.body.accessToken)).expect(401);
  });

  it('rejects unknown / expired refresh tokens', async () => {
    const bad = await ctx
      .http()
      .post(`${api}/auth/refresh`)
      .send({ refreshToken: 'x'.repeat(64) })
      .expect(401);
    expect(bad.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    const u = await registerUser(ctx);
    await ctx.prisma.userSession.updateMany({
      where: { userId: u.userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await ctx
      .http()
      .post(`${api}/auth/refresh`)
      .send({ refreshToken: u.refreshToken })
      .expect(401);
    expect(expired.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('logout revokes the session immediately (access token stops working)', async () => {
    const u = await registerUser(ctx);
    await ctx.http().post(`${api}/auth/logout`).set(auth(u.accessToken)).expect(204);
    await ctx.http().get(`${api}/users/me`).set(auth(u.accessToken)).expect(401);
    await ctx.http().post(`${api}/auth/refresh`).send({ refreshToken: u.refreshToken }).expect(401);
  });

  it('logout-all revokes every device', async () => {
    const u = await registerUser(ctx);
    const otp = await requestOtp(u.phone).expect(200);
    const second = await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({ requestId: otp.body.requestId, code: MOCK_OTP })
      .expect(200);
    const res = await ctx
      .http()
      .post(`${api}/auth/logout-all`)
      .set(auth(u.accessToken))
      .expect(200);
    expect(res.body.revokedSessions).toBe(2);
    await ctx.http().get(`${api}/users/me`).set(auth(second.body.tokens.accessToken)).expect(401);
  });

  it('rejects missing, malformed and tampered access tokens', async () => {
    await ctx.http().get(`${api}/users/me`).expect(401);
    await ctx.http().get(`${api}/users/me`).set({ Authorization: 'Basic abc' }).expect(401);
    const u = await registerUser(ctx);
    const [h, p] = u.accessToken.split('.');
    const forged = `${h}.${p}.invalidsignature`;
    const r = await ctx.http().get(`${api}/users/me`).set(auth(forged)).expect(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('suspended users are blocked immediately and cannot log in', async () => {
    const u = await registerUser(ctx);
    await ctx.prisma.user.update({ where: { id: u.userId }, data: { status: 'SUSPENDED' } });
    const r = await ctx.http().get(`${api}/users/me`).set(auth(u.accessToken)).expect(403);
    expect(r.body.error.code).toBe('ACCOUNT_SUSPENDED');
    const otp = await requestOtp(u.phone).expect(200);
    await ctx
      .http()
      .post(`${api}/auth/otp/verify`)
      .send({ requestId: otp.body.requestId, code: MOCK_OTP })
      .expect(403);
  });

  it('deleted users lose access and the number can register a fresh account', async () => {
    const u = await registerUser(ctx);
    await ctx.http().delete(`${api}/users/me`).set(auth(u.accessToken)).expect(204);
    await ctx.http().get(`${api}/users/me`).set(auth(u.accessToken)).expect(401);
    const again = await registerUser(ctx, 'New', 'Person', u.phone);
    expect(again.userId).not.toBe(u.userId);
  });

  it('admin login works with correct password only; failures are audited', async () => {
    const admin = await createAdmin(ctx);
    expect(admin.token).toBeTruthy();
    const bad = await ctx
      .http()
      .post(`${api}/auth/admin/login`)
      .send({ email: 'nobody@emblemway.test', password: 'wrong-password' })
      .expect(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.admin_login_failed' } })).toBe(
      1,
    );
  });

  it('never writes OTPs or tokens into audit logs', async () => {
    await registerUser(ctx);
    const logs = await ctx.prisma.auditLog.findMany();
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain(MOCK_OTP);
    expect(dump).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
});

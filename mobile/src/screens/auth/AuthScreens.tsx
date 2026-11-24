import { zodResolver } from '@hookform/resolvers/zod';
import React, { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ActivityIndicator, Text, View } from 'react-native';
import { z } from 'zod';
import { api } from '../../api';
import { ApiError } from '../../api/client';
import { useAuthStore } from '../../auth/authStore';
import { Button, Logo, Notice, Screen, TextField } from '../../components/ui';
import { DEFAULT_COUNTRY_CODE } from '../../config/env';
import type { AuthScreenProps } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';
import { errorMessage } from '../../utils/errors';
import {
  loginSchema,
  normalizeIndianMobile,
  otpSchema,
  registerSchema,
} from '../../validation/schemas';

/** Screen 1: branded splash while the stored session is validated. */
export function SplashScreen() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      testID="splash-screen"
    >
      <Logo size={96} />
      <Text
        style={{
          color: colors.white,
          fontSize: 30,
          fontWeight: '800',
          marginTop: spacing.lg,
        }}
      >
        EmblemWay
      </Text>
      <Text style={{ color: colors.primaryLight, marginTop: spacing.xs }}>
        Smarter journeys, together
      </Text>
      <ActivityIndicator
        color={colors.white}
        style={{ marginTop: spacing.xl }}
      />
    </View>
  );
}

function PhonePrefix() {
  return (
    <Text style={[typography.caption, { marginBottom: spacing.xs }]}>
      Country code {DEFAULT_COUNTRY_CODE} (India)
    </Text>
  );
}

/** Login with an existing mobile number. */
export function WelcomeScreen({ navigation }: AuthScreenProps<'Welcome'>) {
  const expired = useAuthStore(s => s.sessionExpiredNotice);
  const dismiss = useAuthStore(s => s.dismissSessionNotice);
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<
    z.infer<typeof loginSchema>
  >({
    resolver: zodResolver(loginSchema),
    defaultValues: { mobileNumber: '' },
  });

  const onSubmit = handleSubmit(async ({ mobileNumber }) => {
    setServerError(null);
    dismiss();
    const national = normalizeIndianMobile(mobileNumber)!;
    try {
      const c = await api.auth.requestOtp(national);
      navigation.navigate('Otp', {
        requestId: c.requestId,
        mobileNumber: national,
        codeLength: c.codeLength,
        resendAvailableAt: c.resendAvailableAt,
      });
    } catch (err) {
      setServerError(errorMessage(err));
    }
  });

  return (
    <Screen testID="welcome-screen">
      <View
        style={{
          alignItems: 'center',
          marginTop: spacing.xxl,
          marginBottom: spacing.xl,
        }}
      >
        <Logo />
        <Text style={[typography.title, { marginTop: spacing.md }]}>
          Welcome to EmblemWay
        </Text>
        <Text
          style={[
            typography.caption,
            { textAlign: 'center', marginTop: spacing.xs },
          ]}
        >
          See who travels your route, when traffic is lighter, and plan better
          journeys across Pune.
        </Text>
      </View>
      {expired ? (
        <Notice
          tone="warning"
          text="Your session expired. Please sign in again."
          testID="session-expired"
        />
      ) : null}
      <PhonePrefix />
      <Controller
        control={control}
        name="mobileNumber"
        render={({ field }) => (
          <TextField
            label="Mobile number"
            placeholder="98765 43210"
            keyboardType="phone-pad"
            maxLength={14}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={formState.errors.mobileNumber?.message}
            testID="login-mobile"
            autoComplete="tel"
          />
        )}
      />
      {serverError ? (
        <Notice tone="danger" text={serverError} testID="login-error" />
      ) : null}
      <Button
        title="Send verification code"
        onPress={onSubmit}
        loading={formState.isSubmitting}
        testID="login-submit"
      />
      <Button
        title="New here? Create an account"
        variant="ghost"
        onPress={() => navigation.navigate('Register')}
        style={{ marginTop: spacing.md }}
        testID="go-register"
      />
      <Text
        style={[
          typography.small,
          { textAlign: 'center', marginTop: spacing.xl },
        ]}
      >
        Your mobile number is never shown to other travellers.
      </Text>
    </Screen>
  );
}

/** Screen 2: registration (first name, last name, mobile; OTP next). */
export function RegisterScreen({ navigation }: AuthScreenProps<'Register'>) {
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<
    z.infer<typeof registerSchema>
  >({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: '', lastName: '', mobileNumber: '', email: '' },
  });

  const onSubmit = handleSubmit(async v => {
    setServerError(null);
    const national = normalizeIndianMobile(v.mobileNumber)!;
    try {
      const c = await api.auth.requestOtp(national);
      navigation.navigate('Otp', {
        requestId: c.requestId,
        mobileNumber: national,
        codeLength: c.codeLength,
        resendAvailableAt: c.resendAvailableAt,
        registration: {
          firstName: v.firstName.trim(),
          lastName: v.lastName.trim(),
          email: v.email || undefined,
        },
      });
    } catch (err) {
      setServerError(errorMessage(err));
    }
  });

  const field = (
    name: 'firstName' | 'lastName' | 'email' | 'mobileNumber',
    label: string,
    extra: object = {},
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field: f }) => (
        <TextField
          label={label}
          value={f.value ?? ''}
          onChangeText={f.onChange}
          onBlur={f.onBlur}
          error={formState.errors[name]?.message}
          testID={`register-${name}`}
          {...extra}
        />
      )}
    />
  );

  return (
    <Screen testID="register-screen">
      <Text style={[typography.title, { marginBottom: spacing.lg }]}>
        Create your account
      </Text>
      {field('firstName', 'First name', {
        autoCapitalize: 'words',
        autoComplete: 'given-name',
      })}
      {field('lastName', 'Last name', {
        autoCapitalize: 'words',
        autoComplete: 'family-name',
      })}
      <PhonePrefix />
      {field('mobileNumber', 'Mobile number', {
        keyboardType: 'phone-pad',
        maxLength: 14,
        placeholder: '98765 43210',
      })}
      {field('email', 'Email (optional)', {
        keyboardType: 'email-address',
        autoCapitalize: 'none',
      })}
      {serverError ? (
        <Notice tone="danger" text={serverError} testID="register-error" />
      ) : null}
      <Button
        title="Continue"
        onPress={onSubmit}
        loading={formState.isSubmitting}
        testID="register-submit"
      />
    </Screen>
  );
}

export function useCountdown(untilIso: string): number {
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.ceil((new Date(untilIso).getTime() - Date.now()) / 1000)),
  );
  useEffect(() => {
    setLeft(
      Math.max(
        0,
        Math.ceil((new Date(untilIso).getTime() - Date.now()) / 1000),
      ),
    );
    const t = setInterval(
      () =>
        setLeft(
          Math.max(
            0,
            Math.ceil((new Date(untilIso).getTime() - Date.now()) / 1000),
          ),
        ),
      1000,
    );
    return () => clearInterval(t);
  }, [untilIso]);
  return left;
}

/** OTP verification with resend cooldown and attempt feedback. */
export function OtpScreen({ route, navigation }: AuthScreenProps<'Otp'>) {
  const { mobileNumber, codeLength, registration } = route.params;
  const completeLogin = useAuthStore(s => s.completeLogin);
  const [requestId, setRequestId] = useState(route.params.requestId);
  const [resendAt, setResendAt] = useState(route.params.resendAvailableAt);
  const [serverError, setServerError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const left = useCountdown(resendAt);
  const schema = otpSchema(codeLength);
  const { control, handleSubmit, formState, reset } = useForm<
    z.infer<typeof schema>
  >({ resolver: zodResolver(schema), defaultValues: { code: '' } });

  const onSubmit = handleSubmit(async ({ code }) => {
    setServerError(null);
    try {
      const result = await api.auth.verifyOtp({
        requestId,
        code,
        ...registration,
      });
      await completeLogin(result);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'REGISTRATION_DETAILS_REQUIRED'
      ) {
        setServerError(
          'No account exists for this number yet. Please register first.',
        );
        navigation.replace('Register');
        return;
      }
      setServerError(errorMessage(err));
      reset({ code: '' });
    }
  });

  const resend = async () => {
    setResending(true);
    setServerError(null);
    try {
      const c = await api.auth.requestOtp(mobileNumber);
      setRequestId(c.requestId);
      setResendAt(c.resendAvailableAt);
      reset({ code: '' });
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <Screen testID="otp-screen">
      <Text style={typography.title}>Verify your number</Text>
      <Text
        style={[
          typography.caption,
          { marginTop: spacing.xs, marginBottom: spacing.lg },
        ]}
      >
        Enter the {codeLength}-digit code sent to {DEFAULT_COUNTRY_CODE}{' '}
        {mobileNumber.slice(0, 5)} {mobileNumber.slice(5)}
      </Text>
      <Controller
        control={control}
        name="code"
        render={({ field }) => (
          <TextField
            label="Verification code"
            keyboardType="number-pad"
            maxLength={codeLength}
            value={field.value}
            onChangeText={t => field.onChange(t.replace(/\D/g, ''))}
            error={formState.errors.code?.message}
            testID="otp-code"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
          />
        )}
      />
      {serverError ? (
        <Notice tone="danger" text={serverError} testID="otp-error" />
      ) : null}
      <Button
        title={registration ? 'Verify & create account' : 'Verify & sign in'}
        onPress={onSubmit}
        loading={formState.isSubmitting}
        testID="otp-submit"
      />
      <Button
        title={left > 0 ? `Resend code in ${left}s` : 'Resend code'}
        variant="ghost"
        disabled={left > 0}
        loading={resending}
        onPress={() => void resend()}
        style={{ marginTop: spacing.md }}
        testID="otp-resend"
      />
    </Screen>
  );
}

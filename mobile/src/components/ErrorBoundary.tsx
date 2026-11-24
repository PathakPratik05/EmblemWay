import React from 'react';
import { Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme';
import { Button, Logo } from './ui';

interface State {
  error: Error | null;
}

/** Last line of defence: a rendering bug shows a recovery screen instead of crashing the app. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.xl,
          backgroundColor: colors.background,
        }}
        testID="error-boundary"
      >
        <Logo />
        <Text style={[typography.heading, { marginTop: spacing.lg }]}>
          Something went wrong
        </Text>
        <Text
          style={[
            typography.caption,
            { textAlign: 'center', marginVertical: spacing.md },
          ]}
        >
          The screen could not be displayed. Your data is safe.
        </Text>
        <Button
          title="Try again"
          onPress={() => this.setState({ error: null })}
        />
      </View>
    );
  }
}

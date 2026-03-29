import { describe, it, expect, beforeEach } from 'vitest';
import { authEventEmitter, type AuthEvent } from '@/lib/authEvents';

describe('authEventEmitter', () => {
  beforeEach(() => {
    // Remove all listeners between tests by registering and immediately removing
    // We create a fresh instance-like state by ensuring no listeners persist
  });

  describe('on / emit', () => {
    it('calls a registered listener when its event type is emitted', () => {
      const received: AuthEvent[] = [];
      const listener = (e: AuthEvent) => received.push(e);

      authEventEmitter.on('signin_success', listener);
      authEventEmitter.emit({ type: 'signin_success' });
      authEventEmitter.off('signin_success', listener);

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('signin_success');
    });

    it('passes event data to the listener', () => {
      const received: AuthEvent[] = [];
      const listener = (e: AuthEvent) => received.push(e);

      authEventEmitter.on('signin_error', listener);
      authEventEmitter.emit({
        type: 'signin_error',
        data: { message: 'Bad credentials', error: 'INVALID_PASSWORD' },
      });
      authEventEmitter.off('signin_error', listener);

      expect(received[0].data?.message).toBe('Bad credentials');
      expect(received[0].data?.error).toBe('INVALID_PASSWORD');
    });

    it('does not call listeners registered for a different event type', () => {
      const called = vi.fn();

      authEventEmitter.on('signup_success', called);
      authEventEmitter.emit({ type: 'signin_success' });
      authEventEmitter.off('signup_success', called);

      expect(called).not.toHaveBeenCalled();
    });

    it('calls multiple listeners registered for the same event type', () => {
      const calls: number[] = [];
      const listenerA = () => calls.push(1);
      const listenerB = () => calls.push(2);

      authEventEmitter.on('logout_error', listenerA);
      authEventEmitter.on('logout_error', listenerB);
      authEventEmitter.emit({ type: 'logout_error' });
      authEventEmitter.off('logout_error', listenerA);
      authEventEmitter.off('logout_error', listenerB);

      expect(calls).toEqual([1, 2]);
    });
  });

  describe('off', () => {
    it('stops calling a listener after it is removed', () => {
      const called = vi.fn();

      authEventEmitter.on('token_expired', called);
      authEventEmitter.off('token_expired', called);
      authEventEmitter.emit({ type: 'token_expired' });

      expect(called).not.toHaveBeenCalled();
    });

    it('only removes the specified listener, leaving others intact', () => {
      const callsA: number[] = [];
      const callsB: number[] = [];
      const listenerA = () => callsA.push(1);
      const listenerB = () => callsB.push(1);

      authEventEmitter.on('token_missing', listenerA);
      authEventEmitter.on('token_missing', listenerB);
      authEventEmitter.off('token_missing', listenerA);
      authEventEmitter.emit({ type: 'token_missing' });
      authEventEmitter.off('token_missing', listenerB);

      expect(callsA).toHaveLength(0);
      expect(callsB).toHaveLength(1);
    });

    it('does not throw when removing an unregistered listener', () => {
      const ghost = () => {};
      expect(() =>
        authEventEmitter.off('profile_error', ghost)
      ).not.toThrow();
    });

    it('does not throw when removing a listener for an event type with no registrations', () => {
      const ghost = () => {};
      expect(() =>
        authEventEmitter.off('signup_error', ghost)
      ).not.toThrow();
    });
  });

  describe('emit with no listeners', () => {
    it('does not throw when emitting an event with no listeners', () => {
      expect(() =>
        authEventEmitter.emit({ type: 'signup_success' })
      ).not.toThrow();
    });
  });

  describe('all event types', () => {
    const allEventTypes: AuthEvent['type'][] = [
      'signin_success',
      'signup_success',
      'signin_error',
      'signup_error',
      'logout_error',
      'profile_error',
      'token_missing',
      'token_expired',
    ];

    it.each(allEventTypes)('handles event type "%s" without error', type => {
      const received: AuthEvent[] = [];
      const listener = (e: AuthEvent) => received.push(e);

      authEventEmitter.on(type, listener);
      authEventEmitter.emit({ type });
      authEventEmitter.off(type, listener);

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe(type);
    });
  });
});

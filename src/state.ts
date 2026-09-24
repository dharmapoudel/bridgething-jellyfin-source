// tiny pub/sub atom with a react hook; no state library needed.
import { useSyncExternalStore } from 'react';

export interface Atom<T> {
  get: () => T;
  set: (v: T | ((prev: T) => T)) => void;
  use: () => T;
}

export function atom<T>(initial: T): Atom<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const subscribe = (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };
  const get = (): T => value;
  const set = (v: T | ((prev: T) => T)): void => {
    value = typeof v === 'function' ? (v as (prev: T) => T)(value) : v;
    for (const fn of listeners) fn();
  };
  const use = (): T => useSyncExternalStore(subscribe, get, get);
  return { get, set, use };
}
